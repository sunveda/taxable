import { getRequestListener } from '@hono/node-server';
import { createDatabase } from '@svdt/db';
import { createApp } from './app';
import { databaseUrl } from './env';

/**
 * Vercel Function entry (see scripts/build-vercel.mjs). Production always uses Postgres;
 * migrations are run by an operator (`pnpm --filter @svdt/api migrate`), never on boot.
 */
const { url, local, caCert } = databaseUrl();
if (local) throw new Error('DATABASE_URL or POSTGRES_URL must be set');
const database = await createDatabase(url, caCert ? { caCert } : {});

export default getRequestListener(createApp(database).fetch);
