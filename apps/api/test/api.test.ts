import { createApiKey, createDatabase, createTenant, migrate, type Database } from '@svdt/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

/** End-to-end through HTTP, against an in-memory Postgres (PGlite) with RLS on. */
let database: Database;
let app: ReturnType<typeof createApp>;
let keyA: string;
let keyB: string;

beforeAll(async () => {
  database = createDatabase();
  await migrate(database);
  await createTenant(database, 'partner-b', 'Partner B');
  keyA = (await createApiKey(database, 'direct', 'test-a')).key;
  keyB = (await createApiKey(database, 'partner-b', 'test-b')).key;
  app = createApp(database);
});
afterAll(() => database.close());

const call = (
  method: string,
  path: string,
  opts: { key?: string | null; json?: unknown; body?: string; type?: string } = {},
) => {
  const headers: Record<string, string> = {};
  const key = opts.key === undefined ? keyA : opts.key;
  if (key) headers['authorization'] = `Bearer ${key}`;
  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.json);
  } else if (opts.body !== undefined) {
    headers['content-type'] = opts.type ?? 'text/csv';
    body = opts.body;
  }
  return app.request(path, { method, headers, ...(body !== undefined ? { body } : {}) });
};

const newUser = async (key = keyA): Promise<string> => {
  const res = await call('POST', '/v1/users', { key, json: {} });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
};

// A purchase, a sale, and BTC sent to an unconnected wallet.
const CSV = `timestamp,type,sent_asset,sent_quantity,received_asset,received_quantity,fee_asset,fee_quantity,id
2025-01-02T10:00:00Z,trade,USD,1000,BTC,0.02,USD,5,t1
2025-06-01T10:00:00Z,trade,BTC,0.01,USD,900,,,t2
2025-07-01T10:00:00Z,withdrawal,BTC,0.01,,,,,t3
`;

const importCsv = (userId: string, csv = CSV, account = 'coinbase', key = keyA) =>
  call('POST', `/v1/users/${userId}/imports?account=${account}&filename=history.csv`, {
    key,
    body: csv,
  });

interface Calc {
  disposals: { gain: string }[];
  issues: { kind: string; eventIds: string[]; suggestedResolution?: { override: unknown } }[];
  overrides: { status: string }[];
  summary: { shortTerm: { gain: string } };
}

const calculate = async (userId: string, key = keyA): Promise<Calc> => {
  const res = await call('POST', `/v1/users/${userId}/calculations`, {
    key,
    json: { jurisdiction: 'us', taxYear: 2025 },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Calc;
};

describe('meta', () => {
  it('serves health and an OpenAPI 3.1 document without auth', async () => {
    expect(await (await call('GET', '/v1/health', { key: null })).json()).toEqual({ ok: true });
    const doc = (await (await call('GET', '/v1/openapi.json', { key: null })).json()) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/v1/users',
        '/v1/users/{userId}/imports',
        '/v1/users/{userId}/overrides',
        '/v1/users/{userId}/calculations',
      ]),
    );
  });
});

describe('auth', () => {
  it('rejects missing and wrong keys', async () => {
    expect((await call('POST', '/v1/users', { key: null, json: {} })).status).toBe(401);
    expect((await call('POST', '/v1/users', { key: 'svdt_wrong', json: {} })).status).toBe(401);
  });

  it("can't see another tenant's users", async () => {
    const userId = await newUser(keyA);
    expect((await call('GET', `/v1/users/${userId}`, { key: keyB })).status).toBe(404);
    expect((await importCsv(userId, CSV, 'coinbase', keyB)).status).toBe(404);
    expect((await call('DELETE', `/v1/users/${userId}`, { key: keyB })).status).toBe(404);
    expect((await call('GET', `/v1/users/${userId}`, { key: keyA })).status).toBe(200);
  });
});

describe('import → fix queue → override → recalculate', () => {
  it('runs the whole loop', async () => {
    const userId = await newUser();

    const imp = await importCsv(userId);
    expect(imp.status).toBe(201);
    expect(await imp.json()).toMatchObject({
      importer: { id: 'svdt.canonical.v1', status: 'verified' },
      stats: { rows: 3, imported: 3 },
      upserted: 3,
      conflicts: [],
    });

    // Re-importing the same file is idempotent.
    expect(((await (await importCsv(userId)).json()) as { upserted: number }).upserted).toBe(3);
    const page = (await (await call('GET', `/v1/users/${userId}/events`)).json()) as {
      data: { id: string }[];
    };
    // Importers namespace ids by format and account, so accounts can't collide.
    expect(page.data.map((e) => e.id)).toEqual(
      ['t1', 't2', 't3'].map((t) => `canonical:coinbase:${t}`),
    );

    const before = await calculate(userId);
    expect(before.disposals.map((d) => d.gain)).toEqual(['397.5']);
    const issue = before.issues.find((i) => i.kind === 'unmatched_withdrawal')!;
    expect(issue.suggestedResolution).toBeDefined();

    // Apply the suggested resolution as-is.
    const posted = await call('POST', `/v1/users/${userId}/overrides`, {
      json: { ...(issue.suggestedResolution!.override as object), note: 'my ledger' },
    });
    expect(posted.status).toBe(201);
    expect(await posted.json()).toMatchObject({
      eventId: 'canonical:coinbase:t3',
      author: 'key:test-a',
    });

    const after = await calculate(userId);
    expect(after.issues.filter((i) => i.kind === 'unmatched_withdrawal')).toEqual([]);
    expect(after.overrides.map((o) => o.status)).toEqual(['applied']);

    // Reclassify as spent: a later override wins, and the gain appears.
    await call('POST', `/v1/users/${userId}/overrides`, {
      json: {
        eventId: 'canonical:coinbase:t3',
        action: { type: 'classify_withdrawal', as: 'spent', proceeds: '1000' },
      },
    });
    const spent = await calculate(userId);
    expect(spent.overrides.map((o) => o.status)).toEqual(['superseded', 'applied']);
    expect(spent.disposals.map((d) => d.gain)).toEqual(['397.5', '497.5']);
    expect(spent.summary.shortTerm.gain).toBe('895');

    const list = (await (await call('GET', `/v1/users/${userId}/overrides`)).json()) as {
      data: unknown[];
    };
    expect(list.data).toHaveLength(2);
  });

  it('matches transfers between the user’s accounts before calculating', async () => {
    const userId = await newUser();
    await importCsv(
      userId,
      `timestamp,type,sent_asset,sent_quantity,received_asset,received_quantity,id
2025-01-02T10:00:00Z,trade,USD,1000,BTC,0.02,b1
2025-03-01T10:00:00Z,withdrawal,BTC,0.02,,,w1
`,
    );
    await importCsv(
      userId,
      `timestamp,type,received_asset,received_quantity,id
2025-03-01T11:00:00Z,deposit,BTC,0.0199,d1
`,
      'ledger',
    );
    const res = await call('POST', `/v1/users/${userId}/calculations`, {
      json: { jurisdiction: 'us', taxYear: 2025 },
    });
    const body = (await res.json()) as Calc & { transferMatches: unknown[] };
    expect(body.transferMatches).toEqual([
      {
        withdrawalId: 'canonical:coinbase:w1',
        depositId: 'canonical:ledger:d1',
        transferId: 'transfer:canonical:coinbase:w1>canonical:ledger:d1',
      },
    ]);
    expect(body.issues.map((i) => i.kind)).not.toContain('unmatched_withdrawal');
  });
});

describe('validation and errors', () => {
  it('rejects bad input with 400 and a readable message', async () => {
    const userId = await newUser();
    const res = await call('POST', `/v1/users/${userId}/overrides`, {
      json: { eventId: 't1', action: { type: 'set_cost_basis', costBasis: '-1' } },
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /costBasis/,
    );
    expect((await call('GET', '/v1/users/not-a-uuid')).status).toBe(400);
    expect((await importCsv(userId, CSV, 'bad account!')).status).toBe(400);
    expect((await call('GET', `/v1/users/${userId}/events?cursor=zzz`)).status).toBe(400);
  });

  it('refuses an override for an unknown event', async () => {
    const userId = await newUser();
    const res = await call('POST', `/v1/users/${userId}/overrides`, {
      json: { eventId: 'nope', action: { type: 'classify_withdrawal', as: 'own_wallet' } },
    });
    expect(res.status).toBe(422);
  });

  it('reports an unknown file format and an unsupported tax year as 422', async () => {
    const userId = await newUser();
    expect((await importCsv(userId, 'a,b\n1,2\n')).status).toBe(422);
    const res = await call('POST', `/v1/users/${userId}/calculations`, {
      json: { jurisdiction: 'jp', taxYear: 2030 },
    });
    expect(res.status).toBe(422);
  });

  it('enforces unique externalRef per tenant', async () => {
    const ref = { externalRef: 'partner-user-1' };
    expect((await call('POST', '/v1/users', { json: ref })).status).toBe(201);
    expect((await call('POST', '/v1/users', { json: ref })).status).toBe(409);
    // Another tenant may use the same ref.
    expect((await call('POST', '/v1/users', { key: keyB, json: ref })).status).toBe(201);
  });
});

describe('deletion', () => {
  it('purges the user and everything they imported', async () => {
    const userId = await newUser();
    await importCsv(userId);
    expect((await call('DELETE', `/v1/users/${userId}`)).status).toBe(204);
    expect((await call('GET', `/v1/users/${userId}`)).status).toBe(404);
    expect((await call('GET', `/v1/users/${userId}/events`)).status).toBe(404);
    expect((await call('DELETE', `/v1/users/${userId}`)).status).toBe(404);
  });
});
