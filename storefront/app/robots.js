import { loadStore } from '../lib/store.js';
import { canonicalOrigin } from '../lib/seo.js';

/**
 * Per-store robots.txt.
 *
 * Three different answers, decided by the store rather than by a static file:
 *
 * - **Unknown domain, suspended store, or a secondary domain** → disallow
 *   everything. A secondary domain is a duplicate of the primary (which
 *   `middleware.js` 301s it to); inviting a crawler to index it anyway would
 *   split the store's own signals across its own domains.
 * - **Anything private** (checkout, account, the storefront's own route
 *   handlers) → disallowed. `/search` is not in that list on purpose: it is
 *   `noindex, follow` at the page level, and a crawler has to be allowed to
 *   fetch a page before it can see that tag.
 * - **Everything else** → allowed, with the sitemap on the primary domain.
 */
export default async function robots() {
  const store = await loadStore();

  const blockEverything = { rules: [{ userAgent: '*', disallow: '/' }] };

  if (!store.company || store.suspended || store.notFound) return blockEverything;
  if (store.company.isPrimaryHost === false) return blockEverything;

  const origin = await canonicalOrigin(store.company);

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/checkout', '/account'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
