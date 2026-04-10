import type { NextConfig } from 'next';
import path from 'node:path';

/**
 * The repo is a monorepo-ish layout — the CLI lives at the root and
 * this dashboard lives in `dashboard/`. Pinning `turbopack.root` to
 * the dashboard folder stops Next.js from walking up to the CLI's
 * package-lock.json and emitting "multiple lockfiles" warnings.
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
