import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The client admin is served at `{store-domain}/admin`, not on a port of its
 * own.
 *
 * A separate Vite port was a development convenience that had quietly become
 * the architecture: it meant a client had to be sent to a different host to
 * manage their own shop, and it meant nothing about the URL said which store
 * you were managing. Under `/admin` on the store's own domain, the tenant is
 * resolved the same way it is everywhere else in this system — from the Host
 * header — and the API is same-origin, so the SPA needs no API URL at all.
 *
 * `build.outDir` points into the storefront's `public/`, which Next serves
 * statically. That is what makes this work identically in local development
 * and behind Nginx, rather than only in production.
 */
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    outDir: '../storefront/public/admin',
    emptyOutDir: true,
  },
  /**
   * The dev server proxies the API too.
   *
   * The panel now calls the API same-origin, because in production it is
   * served by the storefront which proxies these prefixes. Running Vite on its
   * own port without the same proxy left every request going to Vite, which
   * answers with the SPA's index.html or nothing at all — uploads failed with
   * a bare "fetch failed" and gave no clue why.
   *
   * The list matches `storefront/next.config.js` and the `location` blocks in
   * `deploy/nginx/storeforge.conf`. Three copies of one list is two too many;
   * it is worth collapsing into a shared constant the next time it changes.
   */
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      [
        'auth', 'platform', 'orders', 'products', 'cats', 'colls', 'pages',
        'sections', 'banners', 'menus', 'menu-items', 'langs', 'trans',
        'settings', 'admins', 'roles', 'customers', 'dashboard', 'media',
        'storefront',
      ].map((prefix) => [
        `/${prefix}`,
        {
          target: process.env.VITE_PROXY_TARGET ?? 'http://localhost:8003',
          changeOrigin: false,
        },
      ]),
    ),
  },
});
