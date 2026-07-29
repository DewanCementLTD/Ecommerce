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
  server: { port: 5173 },
});
