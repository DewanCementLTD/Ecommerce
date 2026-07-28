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
};

export default nextConfig;
