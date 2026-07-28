import { headers } from 'next/headers';
import { apiGet } from '../lib/api.js';
import { loadStore, langBase } from '../lib/store.js';

/**
 * A per-store, per-language sitemap. Each URL lists its alternates so a crawler
 * can see that `/products/x` and `/ar/products/x` are the same product in two
 * languages rather than duplicate content.
 */
export default async function sitemap() {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const proto = headersList.get('x-forwarded-proto') || 'http';
  const origin = `${proto}://${host}`;

  const store = await loadStore();
  if (!store.company) return [];

  const langs = store.langs.length ? store.langs.map((lang) => lang.code) : [store.defaultLang];

  const [products, cats, pages] = await Promise.all([
    apiGet('/shop/products', { revalidate: 3600, searchParams: { pageSize: 48 } }),
    apiGet('/shop/cats', { revalidate: 3600 }),
    apiGet('/shop/home', { revalidate: 3600 }),
  ]);

  const paths = ['/'];

  const flattenCats = (nodes = []) =>
    nodes.flatMap((node) => [`/cats/${node.slug}`, ...flattenCats(node.children)]);
  paths.push(...flattenCats(cats.data?.tree));

  for (const product of products.data?.rows ?? []) {
    paths.push(`/products/${product.slug}`);
  }
  if (pages.data?.page?.slug) paths.push('/');

  return paths.map((path) => ({
    url: `${origin}${path === '/' ? '' : path}` || origin,
    lastModified: new Date(),
    changeFrequency: path === '/' ? 'daily' : 'weekly',
    priority: path === '/' ? 1 : 0.7,
    alternates: {
      languages: Object.fromEntries(
        langs.map((code) => [
          code,
          `${origin}${langBase(code, store.defaultLang)}${path === '/' ? '' : path}` || origin,
        ]),
      ),
    },
  }));
}
