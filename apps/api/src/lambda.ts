import { readFileSync } from 'node:fs';
import { Signer } from '@aws-sdk/rds-signer';
import { createApiKey, createDatabase, migrate } from '@svdt/db';
import { handle, type LambdaContext, type LambdaEvent } from 'hono/aws-lambda';
import { createApp } from './app';

/**
 * AWS Lambda entry (see scripts/build-lambda.mjs), served through a Function URL. The
 * infrastructure is Terraform in sunveda/iac (`taxable/`): Aurora PostgreSQL in a private
 * VPC, reached only from this function.
 *
 * The function signs in as `DB_USER` with IAM database authentication: each new connection
 * gets a 15-minute token signed with the function's own role, so no database password
 * exists anywhere. TLS is verified against the Amazon RDS CA bundled next to this file.
 */
const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

const host = env('DB_HOST');
const user = env('DB_USER');
const port = 5432;
const signer = new Signer({ hostname: host, port, username: user });

const database = await createDatabase(
  `postgresql://${encodeURIComponent(user)}@${host}:${port}/${encodeURIComponent(env('DB_NAME'))}`,
  {
    caCert: readFileSync(new URL('./rds-ca.pem', import.meta.url), 'utf8'),
    password: () => signer.getAuthToken(),
  },
);

const http = handle(createApp(database));

/**
 * Operator actions, sent by invoking the function directly (`aws lambda invoke`), which
 * needs IAM permission. Function URL requests always carry `requestContext`, so the public
 * URL can't reach these.
 *   {"svdt": "migrate"}                                  (run by the deploy workflow)
 *   {"svdt": "create-key", "name": "web", "tenant": "direct"}  (the key is returned once)
 */
type AdminEvent = { svdt: 'migrate' } | { svdt: 'create-key'; name: string; tenant?: string };

function isAdminEvent(event: unknown): event is AdminEvent {
  return (
    typeof event === 'object' &&
    event !== null &&
    !('requestContext' in event) &&
    'svdt' in event &&
    typeof (event as { svdt: unknown }).svdt === 'string'
  );
}

const migrations = new URL('./migrations/', import.meta.url);

async function admin(event: AdminEvent): Promise<Record<string, unknown>> {
  const applied = await migrate(database, migrations);
  if (event.svdt === 'migrate') return { applied };
  if (event.svdt === 'create-key') {
    if (!event.name) throw new Error('create-key needs "name"');
    const { key } = await createApiKey(database, event.tenant ?? 'direct', event.name);
    return { applied, key };
  }
  throw new Error(`Unknown action ${JSON.stringify((event as { svdt: unknown }).svdt)}`);
}

export const handler = async (event: unknown, context?: LambdaContext) =>
  isAdminEvent(event) ? admin(event) : http(event as LambdaEvent, context);
