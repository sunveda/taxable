// Packages the standalone Next.js build (`SVDT_BUILD_TARGET=lambda next build`) for the
// Lambda function svdt-taxable-web (Node 22, arm64). The AWS Lambda Web Adapter layer starts
// `run.sh`, which runs Next's own server on port 8080, and turns Function URL events into
// HTTP requests to it. Infrastructure is Terraform in sunveda/iac, `taxable/web.tf`.
// CI zips .lambda/ and uploads it with `aws lambda update-function-code`.
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';

const web = new URL('../', import.meta.url);
const standalone = new URL('.next/standalone/', web);
const out = new URL('.lambda/', web);

await stat(new URL('apps/web/server.js', standalone)).catch(() => {
  throw new Error('No standalone build: run `SVDT_BUILD_TARGET=lambda next build` first.');
});

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// pnpm's node_modules use relative symlinks. Keep them as links (zip with -y): Lambda
// restores them, and copying their targets would duplicate packages.
await cp(standalone, out, { recursive: true, verbatimSymlinks: true });

// sharp is only for next/image optimisation, which the app doesn't use. Its native binaries
// match the build machine, not Lambda's arm64, and add ~35 MB.
const pnpmStore = new URL('node_modules/.pnpm/', out);
for (const entry of await readdir(pnpmStore)) {
  if (entry.startsWith('sharp@') || entry.startsWith('@img+')) {
    await rm(new URL(`${entry}/`, pnpmStore), { recursive: true, force: true });
  }
}
// ...and the links to them, which would now dangle.
for (const pkg of [
  'node_modules/',
  ...(await readdir(pnpmStore)).map((e) => `${e}/node_modules/`),
]) {
  for (const name of ['sharp', '@img']) {
    await rm(new URL(pkg + name, pnpmStore), { recursive: true, force: true });
  }
}
// server.js serves these itself when they sit next to it.
await cp(new URL('.next/static/', web), new URL('apps/web/.next/static/', out), {
  recursive: true,
});
await cp(new URL('public/', web), new URL('apps/web/public/', out), { recursive: true }).catch(
  (error) => {
    if (error.code !== 'ENOENT') throw error;
  },
);

const run = new URL('run.sh', out);
await writeFile(
  run,
  '#!/bin/sh\n# Started by the Lambda Web Adapter (AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap).\nexport HOSTNAME=127.0.0.1\nexec node apps/web/server.js\n',
);
await chmod(run, 0o755);

console.log('Built .lambda/ (handler run.sh, Next.js standalone server)');
