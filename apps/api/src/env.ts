import { mkdirSync } from 'node:fs';

/**
 * `DATABASE_URL` if set (Postgres, e.g. Neon via Vercel). Otherwise a local PGlite
 * database under `apps/api/.data/`, created on first use.
 */
export function databaseUrl(): { url: string; local: boolean } {
  const url = process.env['DATABASE_URL'];
  if (url) return { url, local: false };
  const dir = new URL('../.data/pglite', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  return { url: dir, local: true };
}
