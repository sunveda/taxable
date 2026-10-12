import { createApiKey, createDatabase, migrate } from '@svdt/db';
import { databaseUrl } from './env';

/**
 * Operator commands, run with the database owner's credentials:
 *   pnpm --filter @svdt/api migrate
 *   pnpm --filter @svdt/api create-key -- --tenant direct --name web
 */
const [command, ...args] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const database = createDatabase(databaseUrl().url);
try {
  if (command === 'migrate') {
    const applied = await migrate(database);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Up to date.');
  } else if (command === 'create-key') {
    await migrate(database);
    const name = flag('name');
    if (!name) throw new Error('--name is required');
    const { key } = await createApiKey(database, flag('tenant') ?? 'direct', name);
    console.log(`API key (shown once, store it now):\n${key}`);
  } else {
    throw new Error('Usage: cli.ts migrate | create-key --name <name> [--tenant <slug>]');
  }
} finally {
  await database.close();
}
