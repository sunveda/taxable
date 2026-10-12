import { mkdirSync } from 'node:fs';

/**
 * `DATABASE_URL`, else `POSTGRES_URL` (set by the Supabase integration on Vercel).
 * Otherwise a local PGlite database under `apps/api/.data/`, created on first use.
 */
export function databaseUrl(): { url: string; local: boolean } {
  const url = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];
  if (url) return { url, local: false };
  const dir = new URL('../.data/pglite', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  return { url: dir, local: true };
}
