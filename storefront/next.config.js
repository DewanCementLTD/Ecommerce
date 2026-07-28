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
      {
        /**
         * The storefront is the only part of this system that serves HTML to
         * the public, so it is the only part where these headers do anything —
         * the API had them from helmet since Phase 0 and this side had none.
         *
         * The CSP is as tight as a Next.js app can be without a nonce
         * pipeline: `'unsafe-inline'` is required for the framework's own
         * bootstrap script and for the theme's inline custom properties, and
         * `data:` for the generated favicon. Everything else is same-origin
         * only — in particular `frame-ancestors 'none'` (no clickjacking a
         * checkout) and `form-action 'self'` (a stored-XSS payload cannot
         * repoint the checkout form at another host).
         */
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data:",
              "font-src 'self' data:",
              "connect-src 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
              'upgrade-insecure-requests',
            ].join('; '),
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
