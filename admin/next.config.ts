import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * §8: client-side pages calling the API with a bearer token; no server-side data access.
 * `@gym/shared` is TypeScript source in this monorepo, so Next compiles it.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@gym/shared'],
  turbopack: { root: path.join(__dirname, '..') },
  poweredByHeader: false,
};

export default nextConfig;
