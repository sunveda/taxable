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

export interface ConnectionOptions {
  /** PEM text of the server's CA, for verified TLS (see `connection`). */
  caCert?: string;
  /**
   * Called for every new connection instead of a password in the URL. Used for IAM
   * database authentication (Aurora), whose tokens expire after 15 minutes.
   */
  password?: () => Promise<string>;
}

/**
 * `postgres://…` / `postgresql://…` connects to Postgres (Aurora in production).
 * Anything else is a PGlite data directory; omitted means in-memory (tests). PGlite is
 * loaded only when used, so a production bundle needn't include it.
 */
export async function createDatabase(
  url?: string,
  opts: ConnectionOptions = {},
): Promise<Database> {
  if (url && /^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ ...connection(url, opts), max: 5 });
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
  const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
  ]);
  const client = new PGlite(url);
  return {
    db: drizzlePglite(client, { schema }) as unknown as Db,
    exec: async (script) => {
      await client.transaction(async (tx) => {
        await tx.exec(script);
      });
    },
    close: () => client.close(),
  };
}

/**
 * With a CA certificate (PEM), TLS is verified against it and the server's hostname
 * (libpq `verify-full`). Hosted Postgres often signs with its own CA (Amazon RDS, or
 * Supabase's `prod-ca-2021.crt`), which Node doesn't trust by default. The URL's `sslmode`
 * is dropped in that case: node-postgres lets it override the explicit TLS settings.
 *
 * With a password provider the URL is split into fields instead: node-postgres merges a
 * parsed `connectionString` over the other options, and a URL without a password would
 * replace the provider with an empty password.
 */
function connection(url: string, { caCert, password }: ConnectionOptions): pg.PoolConfig {
  if (!caCert && !password) return { connectionString: url };
  const ssl = caCert ? { ssl: { ca: caCert, rejectUnauthorized: true } } : {};
  const u = new URL(url);
  if (password) {
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 5432,
      user: decodeURIComponent(u.username),
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
      password,
      ...ssl,
    };
  }
  u.searchParams.delete('sslmode');
  return { connectionString: u.toString(), ...ssl };
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
