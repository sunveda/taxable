import type { LedgerEvent } from '@svdt/domain';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addOverride,
  authenticate,
  createApiKey,
  createDatabase,
  createTenant,
  createUser,
  listEvents,
  listOverrides,
  loadLedger,
  migrate,
  purgeUser,
  saveImport,
  withoutTenant,
  withTenant,
  type Database,
} from '../src';

const buy = (id: string, timestamp: string, accountId = 'cb'): LedgerEvent => ({
  kind: 'trade',
  id,
  timestamp,
  accountId,
  sent: { asset: 'fiat:USD', quantity: '100' },
  received: { asset: 'BTC', quantity: '0.001' },
});

const file = (s: string) => new TextEncoder().encode(s);

/** The Postgres error behind a failed query (drizzle wraps it as `cause`). */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    const e = err as { message: string; cause?: { message?: string } };
    return e.cause?.message ?? e.message;
  }
  return 'no error';
}

let database: Database;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  database = createDatabase();
  await migrate(database);
  tenantA = await createTenant(database, 'a', 'Tenant A');
  tenantB = await createTenant(database, 'b', 'Tenant B');
});
afterAll(() => database.close());

async function newUser(tenantId: string): Promise<string> {
  return withTenant(database, tenantId, async (tx) => (await createUser(tx, tenantId, null))!.id);
}

async function importEvents(
  tenantId: string,
  userId: string,
  accountName: string,
  evs: LedgerEvent[],
  content = 'csv',
) {
  return withTenant(database, tenantId, (tx) =>
    saveImport(tx, {
      tenantId,
      userId,
      accountName,
      content: file(content),
      filename: 'x.csv',
      encoding: 'utf-8',
      importerId: 'test.v1',
      stats: {},
      warnings: [],
      events: evs,
    }),
  );
}

describe('migrations', () => {
  it('are idempotent', async () => {
    expect(await migrate(database)).toEqual([]);
  });
});

describe('api keys', () => {
  it('authenticates a valid key and rejects others', async () => {
    const { key, tenantId } = await createApiKey(database, 'a', 'test');
    const caller = await withoutTenant(database, (tx) => authenticate(tx, key));
    expect(caller).toEqual({ tenantId, keyName: 'test' });
    expect(await withoutTenant(database, (tx) => authenticate(tx, key + 'x'))).toBeNull();
    expect(await withoutTenant(database, (tx) => authenticate(tx, 'nope'))).toBeNull();
  });

  it('keeps the key table out of the app role', async () => {
    expect(
      await pgError(withoutTenant(database, (tx) => tx.execute(sql`select * from api_keys`))),
    ).toMatch(/permission denied/);
  });
});

describe('imports and events', () => {
  it('stores events, re-normalizes on re-import, and refuses another account’s ids', async () => {
    const user = await newUser(tenantA);
    const first = await importEvents(tenantA, user, 'cb', [
      buy('e1', '2025-01-01T00:00:00Z'),
      buy('e2', '2025-01-02T00:00:00Z'),
    ]);
    expect([first.upserted, first.conflicts]).toEqual([2, []]);

    // Same ids from an improved parser: rewritten in place.
    const changed = { ...buy('e1', '2025-01-01T00:00:00Z'), sourceRef: 'v2' };
    const again = await importEvents(tenantA, user, 'cb', [changed], 'csv v2');
    expect(again.upserted).toBe(1);

    // Same id claimed by a different account: not written.
    const other = await importEvents(tenantA, user, 'kraken', [
      buy('e2', '2025-01-05T00:00:00Z', 'kraken'),
      buy('k1', '2025-01-06T00:00:00Z', 'kraken'),
      buy('k1', '2025-01-06T00:00:00Z', 'kraken'),
    ]);
    // The repeated k1 is caught while deduplicating, before e2 meets the database.
    expect([other.upserted, other.conflicts]).toEqual([1, ['k1', 'e2']]);

    const ledger = await withTenant(database, tenantA, (tx) => loadLedger(tx, tenantA, user));
    expect(ledger.map((e) => [e.id, e.kind === 'trade' ? e.accountId : null, e.sourceRef])).toEqual(
      [
        ['e1', 'cb', 'v2'],
        ['e2', 'cb', undefined],
        ['k1', 'kraken', undefined],
      ],
    );
  });

  it('pages events by time, then id', async () => {
    const user = await newUser(tenantA);
    await importEvents(tenantA, user, 'cb', [
      buy('b', '2025-01-01T00:00:00Z'),
      buy('a', '2025-01-01T00:00:00Z'),
      buy('c', '2025-01-03T00:00:00Z'),
    ]);
    const page1 = await withTenant(database, tenantA, (tx) =>
      listEvents(tx, tenantA, user, { limit: 2 }),
    );
    expect(page1.map((r) => r.id)).toEqual(['a', 'b']);
    const last = page1[1]!;
    const page2 = await withTenant(database, tenantA, (tx) =>
      listEvents(tx, tenantA, user, { limit: 2, after: last }),
    );
    expect(page2.map((r) => [r.id, r.occurredAt])).toEqual([['c', '2025-01-03T00:00:00.000Z']]);
  });
});

describe('tenant isolation (RLS)', () => {
  it('hides other tenants’ rows even without a tenant filter in the query', async () => {
    const user = await newUser(tenantA);
    await importEvents(tenantA, user, 'cb', [buy('iso-1', '2025-01-01T00:00:00Z')]);
    const count = (tenantId: string, table: string) =>
      withTenant(database, tenantId, async (tx) => {
        const r = (await tx.execute(
          sql.raw(`select count(*)::int as n from ${table} where user_id = '${user}'`),
        )) as unknown as { rows: { n: number }[] };
        return r.rows[0]!.n;
      });
    expect(await count(tenantA, 'events')).toBe(1);
    expect(await count(tenantB, 'events')).toBe(0);
    expect(await count(tenantB, 'imports')).toBe(0);
  });

  it('refuses writes into another tenant', async () => {
    const user = await newUser(tenantA);
    expect(
      await pgError(
        withTenant(database, tenantB, (tx) =>
          tx.execute(sql`insert into users (tenant_id, external_ref) values (${tenantA}, 'x')`),
        ),
      ),
    ).toMatch(/row-level security/);
    // B can't attach data to A's user either.
    await expect(importEvents(tenantB, user, 'cb', [])).rejects.toThrow();
  });

  it('sees nothing without a tenant context', async () => {
    const r = (await withoutTenant(database, (tx) =>
      tx.execute(sql`select count(*)::int as n from users`),
    )) as unknown as { rows: { n: number }[] };
    expect(r.rows[0]!.n).toBe(0);
  });
});

describe('overrides', () => {
  it('are append-only for the app role', async () => {
    const user = await newUser(tenantA);
    const o = await withTenant(database, tenantA, (tx) =>
      addOverride(tx, {
        tenantId: tenantA,
        userId: user,
        eventId: 'e1',
        author: 'test',
        note: null,
        action: { type: 'set_cost_basis', costBasis: '1' },
      }),
    );
    expect(
      await pgError(
        withTenant(database, tenantA, (tx) =>
          tx.execute(sql`update overrides set note = 'x' where id = ${o.id}`),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await pgError(
        withTenant(database, tenantA, (tx) =>
          tx.execute(sql`delete from overrides where id = ${o.id}`),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('list oldest first, in insertion order even within one transaction', async () => {
    const user = await newUser(tenantA);
    const ids = await withTenant(database, tenantA, async (tx) => {
      const out: string[] = [];
      for (const n of ['1', '2', '3']) {
        const o = await addOverride(tx, {
          tenantId: tenantA,
          userId: user,
          eventId: 'e1',
          author: 'test',
          note: null,
          action: { type: 'set_cost_basis', costBasis: n },
        });
        out.push(o.id);
      }
      return out;
    });
    const listed = await withTenant(database, tenantA, (tx) => listOverrides(tx, tenantA, user));
    expect(listed.map((o) => o.id)).toEqual(ids);
    expect(listed[0]!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
  });
});

describe('purge', () => {
  it('deletes every layer of a user, and only that user', async () => {
    const gone = await newUser(tenantA);
    const kept = await newUser(tenantA);
    await importEvents(tenantA, gone, 'cb', [buy('p1', '2025-01-01T00:00:00Z')], 'only-gone');
    await importEvents(tenantA, kept, 'cb', [buy('p2', '2025-01-01T00:00:00Z')], 'shared');
    await importEvents(tenantA, gone, 'cb', [buy('p3', '2025-01-01T00:00:00Z')], 'shared');
    await withTenant(database, tenantA, (tx) =>
      addOverride(tx, {
        tenantId: tenantA,
        userId: gone,
        eventId: 'p1',
        author: 't',
        note: null,
        action: {},
      }),
    );

    expect(await withTenant(database, tenantB, (tx) => purgeUser(tx, gone))).toBe(false);
    expect(await withTenant(database, tenantA, (tx) => purgeUser(tx, gone))).toBe(true);

    const blobs = (await database.db.execute(
      sql`select encode(content, 'escape') as c from svdt.raw_blobs where tenant_id = ${tenantA} order by 1`,
    )) as unknown as { rows: { c: string }[] };
    // The blob only `gone` used is deleted; the one `kept` also imported survives.
    expect(blobs.rows.map((r) => r.c)).not.toContain('only-gone');
    expect(blobs.rows.map((r) => r.c)).toContain('shared');
    for (const table of ['users', 'accounts', 'imports', 'events', 'overrides']) {
      const col = table === 'users' ? 'id' : 'user_id';
      const r = (await database.db.execute(
        sql.raw(`select count(*)::int as n from svdt.${table} where ${col} = '${gone}'`),
      )) as unknown as { rows: { n: number }[] };
      expect([table, r.rows[0]!.n]).toEqual([table, 0]);
    }
    expect(await withTenant(database, tenantA, (tx) => loadLedger(tx, tenantA, kept))).toHaveLength(
      1,
    );
  });
});

describe('hosted-platform roles (e.g. Supabase anon/authenticated/service_role)', () => {
  const ROLES = ['anon', 'authenticated', 'service_role'];

  it('get no access to anything we create, even with permissive default privileges', async () => {
    // A fresh database set up like the most permissive hosted platform: its roles exist and
    // are granted everything created from now on, in every schema.
    const hosted = createDatabase();
    try {
      await hosted.exec(
        ROLES.map((r) => `CREATE ROLE ${r} NOLOGIN;`).join('\n') +
          `ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO ${ROLES.join(', ')};
           ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO ${ROLES.join(', ')};
           ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO ${ROLES.join(', ')};
           ALTER DEFAULT PRIVILEGES GRANT ALL ON SCHEMAS TO ${ROLES.join(', ')};`,
      );
      await migrate(hosted);

      const rows = async <T>(q: ReturnType<typeof sql>) =>
        ((await hosted.db.execute(q)) as unknown as { rows: T[] }).rows;
      // Nothing of ours in `public`, which platforms expose as a web API.
      expect(await rows(sql`select tablename from pg_tables where schemaname = 'public'`)).toEqual(
        [],
      );
      expect(
        await rows(sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public'`),
      ).toEqual([]);

      const grants = await rows<{ role: string; object: string }>(sql`
        select r.rolname as role, c.relname as object
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          cross join pg_roles r
         where n.nspname = 'svdt' and c.relkind in ('r', 'S', 'v', 'm')
           and r.rolname in ('anon', 'authenticated', 'service_role')
           and (has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                or (c.relkind = 'S' and has_sequence_privilege(r.oid, c.oid, 'USAGE')))
        union all
        select r.rolname, p.proname
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          cross join pg_roles r
         where n.nspname = 'svdt' and r.rolname in ('anon', 'authenticated', 'service_role')
           and has_function_privilege(r.oid, p.oid, 'EXECUTE')
        union all
        select r.rolname, 'schema svdt' from pg_roles r
         where r.rolname in ('anon', 'authenticated', 'service_role')
           and has_schema_privilege(r.oid, 'svdt', 'USAGE')`);
      expect(grants).toEqual([]);

      // And for real: as `anon`, nothing is reachable.
      for (const q of [
        'select * from svdt.api_keys',
        'select * from svdt.events',
        "select * from svdt.authenticate('x')",
      ]) {
        expect(
          await pgError(
            hosted.db.transaction(async (tx) => {
              await tx.execute(sql`set local role anon`);
              await tx.execute(sql.raw(q));
            }),
          ),
        ).toMatch(/permission denied/);
      }
    } finally {
      await hosted.close();
    }
  });

  it('cannot read API key hashes even if granted the table directly', async () => {
    const r = (await database.db.execute(sql`
      select relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'svdt' and c.relname = 'api_keys'`)) as unknown as {
      rows: { rls: boolean }[];
    };
    // RLS with no policy: any non-owner role sees zero rows.
    expect(r.rows[0]!.rls).toBe(true);
  });
});
