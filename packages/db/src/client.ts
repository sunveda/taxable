import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Database {
  /** Owner connection. Request handlers must go through `withTenant`, never use this directly. */
  db: Db;
  /** Runs a multi-statement SQL script as the owner, in one transaction (migrations). */
  exec(script: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * `postgres://…` / `postgresql://…` connects to Postgres (e.g. Neon via Vercel).
 * Anything else is a PGlite data directory; omitted means in-memory (tests).
 */
export function createDatabase(url?: string): Database {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: 5 });
    return {
      db: drizzlePg(pool, { schema }) as unknown as Db,
      exec: async (script) => {
        const conn = await pool.connect();
        try {
          await conn.query('BEGIN');
          await conn.query(script);
          await conn.query('COMMIT');
        } catch (err) {
          await conn.query('ROLLBACK');
          throw err;
        } finally {
          conn.release();
        }
      },
      close: () => pool.end(),
    };
  }
  const client = new PGlite(url);
  return {
    db: drizzlePglite(client, { schema }) as unknown as Db,
    exec: async (script) => {
      await client.exec(script);
    },
    close: () => client.close(),
  };
}

/**
 * Runs `fn` in a transaction confined to one tenant: sets the tenant context and drops to
 * the `svdt_app` role, so row-level security applies even if a query forgets a filter
 * (ADR-0011: isolation is enforced in the data layer and by Postgres).
 */
export async function withTenant<T>(
  database: Database,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('svdt.tenant_id', ${tenantId}, true)`);
    await tx.execute(sql`set local role svdt_app`);
    await tx.execute(sql`set local search_path to svdt`);
    return fn(tx);
  });
}

/** As `withTenant`, before a tenant is known (authentication). */
export async function withoutTenant<T>(database: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return database.db.transaction(async (tx) => {
    await tx.execute(sql`set local role svdt_app`);
    await tx.execute(sql`set local search_path to svdt`);
    return fn(tx);
  });
}
