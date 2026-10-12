import { createHash, randomBytes } from 'node:crypto';
import type { LedgerEvent } from '@svdt/domain';
import { and, asc, desc, eq, gt, or, sql } from 'drizzle-orm';
import type { Database, Tx } from './client';
import { accounts, events, imports, overrides, rawBlobs, tenants, users } from './schema';

/**
 * Data access. Every function takes a transaction from `withTenant` and still filters by
 * tenant explicitly: RLS is the second line of defence, not the only one (ADR-0011).
 */

export interface Caller {
  tenantId: string;
  keyName: string;
}

export const API_KEY_PREFIX = 'svdt_';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Owner operation (CLI): creates a key and returns it. Only its hash is stored. */
export async function createApiKey(
  database: Database,
  tenantSlug: string,
  name: string,
): Promise<{ key: string; tenantId: string }> {
  const [tenant] = await database.db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, tenantSlug));
  if (!tenant) throw new Error(`No tenant "${tenantSlug}"`);
  const key = API_KEY_PREFIX + randomBytes(32).toString('base64url');
  await database.db.execute(
    sql`insert into svdt.api_keys (tenant_id, name, key_hash) values (${tenant.id}, ${name}, ${hashApiKey(key)})`,
  );
  return { key, tenantId: tenant.id };
}

/** Owner operation (CLI, tests): creates a tenant. */
export async function createTenant(
  database: Database,
  slug: string,
  name: string,
): Promise<string> {
  const [row] = await database.db
    .insert(tenants)
    .values({ slug, name })
    .returning({ id: tenants.id });
  return row!.id;
}

export async function authenticate(tx: Tx, key: string): Promise<Caller | null> {
  if (!key.startsWith(API_KEY_PREFIX)) return null;
  const result = (await tx.execute(
    sql`select tenant_id, key_name from svdt.authenticate(${hashApiKey(key)})`,
  )) as unknown as { rows: { tenant_id: string; key_name: string }[] };
  const row = result.rows[0];
  return row ? { tenantId: row.tenant_id, keyName: row.key_name } : null;
}

// --- Users ------------------------------------------------------------------------------

export interface UserRow {
  id: string;
  externalRef: string | null;
  createdAt: string;
}

export async function createUser(
  tx: Tx,
  tenantId: string,
  externalRef: string | null,
): Promise<UserRow | null> {
  const [row] = await tx
    .insert(users)
    .values({ tenantId, externalRef })
    .onConflictDoNothing()
    .returning({ id: users.id, externalRef: users.externalRef, createdAt: users.createdAt });
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

export async function getUser(tx: Tx, tenantId: string, userId: string): Promise<UserRow | null> {
  const [row] = await tx
    .select({ id: users.id, externalRef: users.externalRef, createdAt: users.createdAt })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
}

/** Deletes the user and every layer of their data. Returns false if there was no such user. */
export async function purgeUser(tx: Tx, userId: string): Promise<boolean> {
  const result = (await tx.execute(
    sql`select svdt.purge_user(${userId}) as purged`,
  )) as unknown as {
    rows: { purged: boolean }[];
  };
  return result.rows[0]?.purged === true;
}

// --- Imports ----------------------------------------------------------------------------

export interface SaveImportInput {
  tenantId: string;
  userId: string;
  accountName: string;
  content: Uint8Array;
  filename: string | null;
  encoding: string;
  importerId: string;
  stats: unknown;
  warnings: unknown;
  events: readonly LedgerEvent[];
}

export interface SaveImportResult {
  importId: string;
  sha256: string;
  /** Events written (new or re-normalized). */
  upserted: number;
  /** Ids already used by another account of this user, or repeated in the file; not written. */
  conflicts: string[];
}

const CHUNK = 500;

/**
 * Stores the raw file (once per content hash), records the import, and upserts its events.
 * Re-importing the same or an updated export rewrites events by id (re-normalization,
 * ADR-0009), but never takes over an id that belongs to a different account.
 */
export async function saveImport(tx: Tx, input: SaveImportInput): Promise<SaveImportResult> {
  const { tenantId, userId, accountName } = input;
  const sha256 = createHash('sha256').update(input.content).digest('hex');
  await tx.insert(accounts).values({ tenantId, userId, name: accountName }).onConflictDoNothing();
  await tx
    .insert(rawBlobs)
    .values({ tenantId, sha256, content: input.content, sizeBytes: input.content.byteLength })
    .onConflictDoNothing();
  const [imp] = await tx
    .insert(imports)
    .values({
      tenantId,
      userId,
      accountName,
      sha256,
      filename: input.filename,
      encoding: input.encoding,
      importerId: input.importerId,
      stats: input.stats,
      warnings: input.warnings,
    })
    .returning({ id: imports.id });
  const importId = imp!.id;

  let upserted = 0;
  const conflicts: string[] = [];
  // One row per id: a repeated id in one file can't be upserted twice in one statement.
  const unique: LedgerEvent[] = [];
  const seen = new Set<string>();
  for (const e of input.events) {
    if (seen.has(e.id)) conflicts.push(e.id);
    else {
      seen.add(e.id);
      unique.push(e);
    }
  }
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const written = await tx
      .insert(events)
      .values(
        chunk.map((e) => ({
          tenantId,
          userId,
          id: e.id,
          accountName,
          kind: e.kind,
          occurredAt: new Date(e.timestamp),
          payload: e,
          importId,
          importerId: input.importerId,
        })),
      )
      .onConflictDoUpdate({
        target: [events.tenantId, events.userId, events.id],
        set: {
          kind: sql`excluded.kind`,
          occurredAt: sql`excluded.occurred_at`,
          payload: sql`excluded.payload`,
          importId: sql`excluded.import_id`,
          importerId: sql`excluded.importer_id`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${events.accountName} = excluded.account_name`,
      })
      .returning({ id: events.id });
    upserted += written.length;
    const ok = new Set(written.map((w) => w.id));
    for (const e of chunk) if (!ok.has(e.id)) conflicts.push(e.id);
  }
  return { importId, sha256, upserted, conflicts };
}

// --- Events -----------------------------------------------------------------------------

export interface EventRow {
  id: string;
  accountName: string;
  occurredAt: string;
  importerId: string;
  event: LedgerEvent;
}

/** Keyset pagination by (occurred_at, id). */
export async function listEvents(
  tx: Tx,
  tenantId: string,
  userId: string,
  opts: { limit: number; after?: { occurredAt: string; id: string } },
): Promise<EventRow[]> {
  const scope = and(eq(events.tenantId, tenantId), eq(events.userId, userId));
  const rows = await tx
    .select({
      id: events.id,
      accountName: events.accountName,
      occurredAt: events.occurredAt,
      importerId: events.importerId,
      payload: events.payload,
    })
    .from(events)
    .where(
      opts.after
        ? and(
            scope,
            or(
              gt(events.occurredAt, new Date(opts.after.occurredAt)),
              and(
                eq(events.occurredAt, new Date(opts.after.occurredAt)),
                gt(events.id, opts.after.id),
              ),
            ),
          )
        : scope,
    )
    .orderBy(asc(events.occurredAt), asc(events.id))
    .limit(opts.limit);
  return rows.map(({ payload, occurredAt, ...r }) => ({
    ...r,
    occurredAt: occurredAt.toISOString(),
    event: payload as LedgerEvent,
  }));
}

export async function eventExists(
  tx: Tx,
  tenantId: string,
  userId: string,
  eventId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.userId, userId), eq(events.id, eventId)));
  return row !== undefined;
}

/**
 * Whether `eventId` names something an override can target: a stored event, or a transfer
 * the matcher builds from two stored events (`transfer:<withdrawal>><deposit>`). If a later
 * import breaks that match, the override is reported as orphaned, never dropped.
 */
export async function overrideTargetExists(
  tx: Tx,
  tenantId: string,
  userId: string,
  eventId: string,
): Promise<boolean> {
  if (!eventId.startsWith(TRANSFER_PREFIX)) return eventExists(tx, tenantId, userId, eventId);
  const rest = eventId.slice(TRANSFER_PREFIX.length);
  for (let i = rest.indexOf('>'); i > 0; i = rest.indexOf('>', i + 1)) {
    const [w, d] = [rest.slice(0, i), rest.slice(i + 1)];
    if (
      (await eventExists(tx, tenantId, userId, w)) &&
      (await eventExists(tx, tenantId, userId, d))
    ) {
      return true;
    }
  }
  return false;
}

const TRANSFER_PREFIX = 'transfer:';

export interface ImportRow {
  id: string;
  accountName: string;
  filename: string | null;
  importerId: string;
  stats: { rows: number; imported: number; skipped: number };
  warningCount: number;
  createdAt: string;
}

/** Newest first. */
export async function listImports(tx: Tx, tenantId: string, userId: string): Promise<ImportRow[]> {
  const rows = await tx
    .select({
      id: imports.id,
      accountName: imports.accountName,
      filename: imports.filename,
      importerId: imports.importerId,
      stats: imports.stats,
      warnings: imports.warnings,
      createdAt: imports.createdAt,
    })
    .from(imports)
    .where(and(eq(imports.tenantId, tenantId), eq(imports.userId, userId)))
    .orderBy(desc(imports.createdAt), desc(imports.id));
  return rows.map(({ warnings, stats, createdAt, ...r }) => ({
    ...r,
    stats: stats as ImportRow['stats'],
    warningCount: Array.isArray(warnings) ? warnings.length : 0,
    createdAt: createdAt.toISOString(),
  }));
}

/** The user's whole normalized ledger, for a calculation. */
export async function loadLedger(tx: Tx, tenantId: string, userId: string): Promise<LedgerEvent[]> {
  const rows = await tx
    .select({ payload: events.payload })
    .from(events)
    .where(and(eq(events.tenantId, tenantId), eq(events.userId, userId)))
    .orderBy(asc(events.occurredAt), asc(events.id));
  return rows.map((r) => r.payload as LedgerEvent);
}

// --- Overrides --------------------------------------------------------------------------

export interface OverrideRow {
  id: string;
  eventId: string;
  author: string;
  note: string | null;
  action: unknown;
  createdAt: string;
}

const overrideColumns = {
  id: overrides.id,
  eventId: overrides.eventId,
  author: overrides.author,
  note: overrides.note,
  action: overrides.action,
  createdAt: overrides.createdAt,
};

export async function addOverride(
  tx: Tx,
  input: {
    tenantId: string;
    userId: string;
    eventId: string;
    author: string;
    note: string | null;
    action: unknown;
  },
): Promise<OverrideRow> {
  const [row] = await tx.insert(overrides).values(input).returning(overrideColumns);
  return { ...row!, createdAt: row!.createdAt.toISOString() };
}

/** In insertion order: the order the override layer is applied in. */
export async function listOverrides(
  tx: Tx,
  tenantId: string,
  userId: string,
): Promise<OverrideRow[]> {
  const rows = await tx
    .select(overrideColumns)
    .from(overrides)
    .where(and(eq(overrides.tenantId, tenantId), eq(overrides.userId, userId)))
    .orderBy(asc(overrides.seq));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}
