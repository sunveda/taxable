import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (ADR-0002).
  transpilePackages: ['@svdt/domain', '@svdt/importers', '@svdt/rule-packs', '@svdt/tax-engine'],
  experimental: {
    // CSV uploads go through a Server Action: 20 MB files plus multipart overhead.
    serverActions: { bodySizeLimit: '21mb' },
  },
};

export default nextConfig;
