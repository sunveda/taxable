import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source (ADR-0002).
  transpilePackages: ['@svdt/domain', '@svdt/rule-packs', '@svdt/tax-engine'],
};

export default nextConfig;
