import type { NextConfig } from 'next';
import { fileURLToPath } from 'node:url';

// `pnpm build:lambda` sets this to build a self-contained server for AWS Lambda
// (scripts/package-lambda.mjs). Plain `next build` (Vercel) is unchanged.
const forLambda = process.env['SVDT_BUILD_TARGET'] === 'lambda';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (ADR-0002).
  transpilePackages: ['@svdt/domain', '@svdt/importers', '@svdt/rule-packs', '@svdt/tax-engine'],
  experimental: {
    // CSV uploads go through a Server Action: 4 MB files plus multipart overhead.
    serverActions: { bodySizeLimit: '5mb' },
  },
  ...(forLambda && {
    output: 'standalone',
    // Trace from the monorepo root so workspace packages land in the bundle.
    outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  }),
};

export default nextConfig;
