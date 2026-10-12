// Bundles the API into one Vercel Function using the Build Output API
// (https://vercel.com/docs/build-output-api). Workspace packages ship TypeScript source,
// so bundling is what makes them runnable; PGlite (local/test only) stays out.
import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const out = new URL('../.vercel/output/', import.meta.url);
const fn = new URL('functions/index.func/', out);

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({
  entryPoints: [new URL('../src/vercel.ts', import.meta.url).pathname],
  outfile: new URL('index.mjs', fn).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CommonJS dependencies (pg) call require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // drizzle-orm/pglite imports PGlite statically, so it must stay out too; both are only
  // loaded (dynamically) for local databases.
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'pg-native'],
  sourcemap: 'linked',
  logLevel: 'warning',
});

await writeFile(
  new URL('.vc-config.json', fn),
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      // Tokyo: next to the database, and Japan is the first market.
      regions: ['hnd1'],
      maxDuration: 60,
    },
    null,
    2,
  ),
);
await writeFile(
  new URL('config.json', out),
  JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }, null, 2),
);
console.log('Built .vercel/output (1 function, region hnd1)');
