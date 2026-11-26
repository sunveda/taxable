// Bundles the API into one AWS Lambda function (handler `index.handler`, Node 22, arm64).
// Same esbuild settings as build-vercel.mjs: workspace packages ship TypeScript source, so
// bundling is what makes them runnable; PGlite (local/test only) stays out.
// CI zips .lambda/ and uploads it with `aws lambda update-function-code`.
import { build } from 'esbuild';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const out = new URL('../.lambda/', import.meta.url);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({
  entryPoints: [fileURLToPath(new URL('../src/lambda.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('index.mjs', out)),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  // CommonJS dependencies (pg, the AWS SDK) call require() for Node built-ins.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  external: ['@electric-sql/pglite', 'drizzle-orm/pglite', 'pg-native'],
  sourcemap: 'linked',
  logLevel: 'warning',
});

console.log('Built .lambda/ (handler index.handler)');
