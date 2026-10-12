import { readdir, readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import type { Database } from './client';

const DIR = new URL('../migrations/', import.meta.url);

/** Applies pending `migrations/*.sql` in name order, each in its own transaction. */
export async function migrate(database: Database): Promise<string[]> {
  await database.exec(
    'CREATE SCHEMA IF NOT EXISTS svdt; CREATE TABLE IF NOT EXISTS svdt.schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  const result = (await database.db.execute(
    sql`SELECT version FROM svdt.schema_migrations`,
  )) as unknown as {
    rows: { version: string }[];
  };
  const done = new Set(result.rows.map((r) => r.version));
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const script = await readFile(new URL(file, DIR), 'utf8');
    // `version` comes from our own file names, never from input.
    await database.exec(
      `${script}\nINSERT INTO svdt.schema_migrations (version) VALUES ('${version}');`,
    );
    applied.push(version);
  }
  return applied;
}
