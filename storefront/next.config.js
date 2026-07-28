import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * This repo keeps exactly one `.env`, at the root, and the API reads it the
 * same way (`api/src/config/env.js`). Next only looks in its own workspace
 * directory, so it is pointed at the root file explicitly rather than asking
 * anyone to maintain a second copy of the same secrets in `storefront/.env`.
 *
 * This file is evaluated in the server process (and again at build time, which
 * is what puts API_URL into the middleware bundle), so everything loaded here
 * is available to route handlers and to `middleware.js`.
 */
config({ path: path.join(path.resolve(fileURLToPath(import.meta.url), '../..'), '.env') });

const API_URL = process.env.API_URL ?? 'http://localhost:8003';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @storeforge/shared is plain ESM source in this monorepo, not a built
  // package, so Next has to compile it like app code.
  transpilePackages: ['@storeforge/shared'],

  /**
   * Images are served from the storefront's own origin and proxied to the API.
   * The media route resolves its tenant from the Host header, so a browser
   * fetching it directly from the API's hostname would resolve to no store at
   * all. Next forwards x-forwarded-host, which is what the resolver reads.
   */
  async rewrites() {
    return [
      { source: '/storefront/media/:path*', destination: `${API_URL}/storefront/media/:path*` },
    ];
  },

  /**
   * Long-lived, immutable caching for media. The URL carries the media id and
   * an explicit width, and both the id and the file behind it are stable —
   * re-uploading an image creates a new row with a new id rather than
   * replacing the bytes at an existing URL, so a stale cache entry is not a
   * thing that can happen here.
   */
  async headers() {
    return [
      {
        source: '/storefront/media/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
