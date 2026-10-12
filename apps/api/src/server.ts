import { serve } from '@hono/node-server';
import { createDatabase, migrate } from '@svdt/db';
import { createApp } from './app';
import { databaseUrl } from './env';

/**
 * Local server. `DATABASE_URL` points at Postgres; without it, data lives in an embedded
 * PGlite database under `.data/` and migrations run on start.
 */
const { url, local } = databaseUrl();
const database = await createDatabase(url);
if (local) await migrate(database);

const port = Number(process.env['PORT'] ?? 8787);
serve({ fetch: createApp(database).fetch, port }, () => {
  console.log(`svdt API on http://localhost:${port} (OpenAPI: /v1/openapi.json)`);
});
