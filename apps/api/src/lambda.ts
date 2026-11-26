import { readFileSync } from 'node:fs';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { Signer } from '@aws-sdk/rds-signer';
import { createApiKey, createDatabase, migrate } from '@svdt/db';
import { handle, type LambdaContext, type LambdaEvent } from 'hono/aws-lambda';
import { createApp } from './app';

/**
 * AWS Lambda entry (see scripts/build-lambda.mjs), served through a Function URL. The
 * infrastructure is Terraform in sunveda/iac (`taxable/`): RDS for PostgreSQL in a private
 * VPC, reached only from this function.
 *
 * The function signs in as `DB_USER` with IAM database authentication: each new connection
 * gets a 15-minute token signed with the function's own role, so no database password is
 * stored for it. TLS is verified against the Amazon RDS CA bundled next to this file.
 */
const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

const host = env('DB_HOST');
const user = env('DB_USER');
const dbName = env('DB_NAME');
const port = 5432;
const caCert = readFileSync(new URL('./rds-ca.pem', import.meta.url), 'utf8');
const signer = new Signer({ hostname: host, port, username: user });
const urlFor = (login: string, password?: string): string =>
  `postgresql://${encodeURIComponent(login)}${password === undefined ? '' : `:${encodeURIComponent(password)}`}@${host}:${port}/${encodeURIComponent(dbName)}`;

const database = await createDatabase(urlFor(user), {
  caCert,
  password: () => signer.getAuthToken(),
});

const http = handle(createApp(database));

/**
 * Operator actions, sent by invoking the function directly (`aws lambda invoke`), which
 * needs IAM permission. Function URL requests always carry `requestContext`, so the public
 * URL can't reach these.
 *   {"svdt": "bootstrap"}  once per new database: creates DB_USER for IAM sign-in
 *   {"svdt": "migrate"}    run by the deploy workflow
 *   {"svdt": "create-key", "name": "web", "tenant": "direct"}  the key is returned once
 */
type AdminEvent =
  | { svdt: 'bootstrap' }
  | { svdt: 'migrate' }
  | { svdt: 'create-key'; name: string; tenant?: string };

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
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Signs in once as the RDS-managed master user (secret `MASTER_SECRET`, reachable only while
 * the Secrets Manager endpoint is on) and creates DB_USER: it may create roles (migrations
 * create `svdt_app`) and schemas, and can sign in only with IAM tokens (`rds_iam`).
 * Idempotent.
 */
async function bootstrap(): Promise<Record<string, unknown>> {
  if (!IDENTIFIER.test(user) || !IDENTIFIER.test(dbName)) {
    throw new Error('DB_USER and DB_NAME must be plain lower-case identifiers');
  }
  const secret = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: env('MASTER_SECRET') }),
  );
  const master = JSON.parse(secret.SecretString ?? '{}') as {
    username?: string;
    password?: string;
  };
  if (!master.username || !master.password) throw new Error('Master secret has no credentials');
  const admin = await createDatabase(urlFor(master.username, master.password), { caCert });
  try {
    await admin.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${user}') THEN
          CREATE ROLE ${user} LOGIN CREATEROLE;
        END IF;
      END
      $$;
      GRANT rds_iam TO ${user};
      GRANT CREATE ON DATABASE ${dbName} TO ${user};
    `);
  } finally {
    await admin.close();
  }
  return { bootstrapped: user };
}

async function admin(event: AdminEvent): Promise<Record<string, unknown>> {
  if (event.svdt === 'bootstrap') return bootstrap();
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
