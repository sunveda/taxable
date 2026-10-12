import {
  bigint,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Typed mirror of `migrations/*.sql`, which are the source of truth (RLS, roles and
 * functions live there). `test/schema.test.ts` exercises every table to catch drift.
 */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const users = pgTable(
  'users',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull().defaultRandom(),
    externalRef: text('external_ref'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const accounts = pgTable(
  'accounts',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.name] })],
);

export const rawBlobs = pgTable(
  'raw_blobs',
  {
    tenantId: uuid('tenant_id').notNull(),
    sha256: text('sha256').notNull(),
    content: bytea('content').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.sha256] })],
);

export const imports = pgTable(
  'imports',
  {
    tenantId: uuid('tenant_id').notNull(),
    id: uuid('id').notNull().defaultRandom(),
    userId: uuid('user_id').notNull(),
    accountName: text('account_name').notNull(),
    sha256: text('sha256').notNull(),
    filename: text('filename'),
    encoding: text('encoding').notNull(),
    importerId: text('importer_id').notNull(),
    stats: jsonb('stats').notNull(),
    warnings: jsonb('warnings').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const events = pgTable(
  'events',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    id: text('id').notNull(),
    accountName: text('account_name').notNull(),
    kind: text('kind').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    importId: uuid('import_id').notNull(),
    importerId: text('importer_id').notNull(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.id] }),
    index('events_by_time').on(t.tenantId, t.userId, t.occurredAt, t.id),
  ],
);

export const overrides = pgTable(
  'overrides',
  {
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id').notNull(),
    id: uuid('id').notNull().defaultRandom(),
    eventId: text('event_id').notNull(),
    author: text('author').notNull(),
    note: text('note'),
    action: jsonb('action').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.userId, t.id] }),
    index('overrides_in_order').on(t.tenantId, t.userId, t.seq),
  ],
);
