/** @type {import('next').NextConfig} */
const nextConfig = {
  // @storeforge/shared is plain ESM source in this monorepo, not a built
  // package, so Next has to compile it like app code.
  transpilePackages: ['@storeforge/shared'],
};

export default nextConfig;
