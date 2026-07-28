import { apiGet } from '../lib/api.js';
import { loadStore, langBase } from '../lib/store.js';
import { canonicalOrigin } from '../lib/seo.js';

/**
 * A per-store sitemap, on the store's primary domain, with every URL listing
 * its language alternates.
 *
 * The path list comes from `/shop/sitemap` in one call — the storefront cannot
 * assemble a complete one by walking the paged catalog endpoints over HTTP, and
 * the previous version silently listed only the first 48 products.
 *
 * Languages are alternates, not separate entries: `/products/x` and
 * `/ar/products/x` are the same product described twice, which is exactly what
 * `alternates.languages` says. A suspended store, an unknown domain or a
 * secondary domain gets an empty sitemap, matching what robots.txt says about
 * all three.
 */
export default async function sitemap() {
  const store = await loadStore();
  if (!store.company || store.suspended || store.notFound) return [];
  if (store.company.isPrimaryHost === false) return [];

  const origin = await canonicalOrigin(store.company);
  const res = await apiGet('/shop/sitemap', { revalidate: 3600 });
  const urls = res.data?.urls ?? [];

  const langs = store.langs.length ? store.langs.map((lang) => lang.code) : [store.defaultLang];

  const absolute = (lang, path) =>
    `${origin}${langBase(lang, store.defaultLang)}${path === '/' ? '' : path}` || origin;

  return urls.map((entry) => ({
    url: absolute(store.defaultLang, entry.path),
    lastModified: entry.lastModified ? new Date(entry.lastModified) : undefined,
    changeFrequency: entry.changeFrequency,
    priority: entry.priority,
    ...(langs.length > 1
      ? {
          alternates: {
            languages: Object.fromEntries(langs.map((code) => [code, absolute(code, entry.path)])),
          },
        }
      : {}),
  }));
}
