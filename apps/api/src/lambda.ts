import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { createDatabase } from '@svdt/db';
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';
import { databaseUrl } from './env';

/**
 * AWS Lambda entry (see scripts/build-lambda.mjs), served through a Function URL. The
 * infrastructure is Terraform in sunveda/iac (`taxable/`).
 *
 * Secrets live in SSM Parameter Store under `SSM_PREFIX` (e.g. `/taxable/prod/DATABASE_URL`)
 * and are read once per cold start, so they never sit in the function's configuration.
 * Variables already set in the environment win, which keeps local runs simple.
 */
const SECRETS = ['DATABASE_URL', 'DATABASE_CA_CERT'] as const;

async function loadSecrets(prefix: string | undefined): Promise<void> {
  if (!prefix) return;
  const { Parameters = [] } = await new SSMClient({}).send(
    new GetParametersCommand({
      Names: SECRETS.map((name) => `${prefix}/${name}`),
      WithDecryption: true,
    }),
  );
  for (const { Name, Value } of Parameters) {
    if (Name && Value !== undefined) process.env[Name.slice(prefix.length + 1)] ??= Value;
  }
}

await loadSecrets(process.env['SSM_PREFIX']);

// Production always uses Postgres; migrations are run by an operator, never on boot.
// Check first: without a URL, databaseUrl() would try to create a local PGlite directory,
// and the Lambda filesystem is read-only.
if (!process.env['DATABASE_URL'] && !process.env['POSTGRES_URL']) {
  throw new Error('DATABASE_URL must be set (SSM parameter or environment)');
}
const { url, local, caCert } = databaseUrl();
if (local) throw new Error('DATABASE_URL must point at Postgres');
const database = await createDatabase(url, caCert ? { caCert } : {});

export const handler = handle(createApp(database));
