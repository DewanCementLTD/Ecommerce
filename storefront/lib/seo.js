import { headers } from 'next/headers';

/**
 * Everything the `<head>` needs that is not page content.
 *
 * Two rules run through this whole file:
 *
 * 1. **The canonical origin is the store's primary domain, not the domain the
 *    request arrived on.** A company can own several hosts; exactly one is
 *    flagged primary in `domains`. Every canonical, every `hreflang` alternate,
 *    every absolute URL in JSON-LD and every sitemap entry names that one, so a
 *    crawler that reaches a secondary domain still consolidates its signals
 *    onto the primary. `middleware.js` also 301s those requests, but the tags
 *    have to be right on their own — a redirect that a crawler has not followed
 *    yet must not advertise a duplicate.
 *
 * 2. **Nothing is hardcoded per client.** Titles, descriptions, social handles
 *    and the OG image all come from `settings`, with generated fallbacks built
 *    from the store's own name.
 */

/** The request's own origin — what the visitor actually typed. */
export async function requestOrigin() {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost';
  const proto = headersList.get('x-forwarded-proto') || 'http';
  return `${proto}://${host}`;
}

/**
 * The origin every canonical URL must use. Falls back to the request's own
 * origin when the store has no primary domain flagged — the only safe answer,
 * since claiming some other domain is canonical would be worse than claiming
 * this one is.
 *
 * The port is carried over from the request: in development the primary host is
 * `demo-a.localhost` while the storefront answers on `:4000`, and a canonical
 * pointing at port 80 would be a link to nothing.
 */
export async function canonicalOrigin(company) {
  const origin = await requestOrigin();
  if (!company?.primaryHost) return origin;

  const url = new URL(origin);
  const port = url.port;
  url.hostname = company.primaryHost;
  url.port = port;
  return url.origin;
}

/** Absolute URL on the canonical origin, for OG tags and JSON-LD. */
export function absolute(origin, path) {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * `{page} | {store}`, the pattern the phase brief asks for, with the store name
 * dropped when the page title already is the store name (the home page) so no
 * title ever reads "Demo Store | Demo Store".
 */
export function pageTitle(title, storeName) {
  if (!title) return storeName;
  if (!storeName || title.trim() === storeName.trim()) return title;
  return `${title} | ${storeName}`;
}

/**
 * A per-store favicon.
 *
 * Every store on this platform answers on its own domain, so a single checked-in
 * `favicon.ico` would be both wrong (one client's mark on another's tab) and a
 * hardcoded asset, which this project does not do. A store with a logo uses it;
 * a store without one gets a generated mark — its initial on its own primary
 * colour, inline as a data URI, so it costs no request.
 *
 * Without an explicit icon the browser requests `/favicon.ico` unprompted,
 * gets a 404, and logs a console error — which is exactly how this was found
 * (Lighthouse's "browser errors were logged to the console", chased down with
 * `npm run ui:check`).
 */
export function faviconFor(company, tokens) {
  if (company?.logoUrl) return company.logoUrl;

  const initial = (company?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const background = tokens?.color?.primary ?? '#111111';
  const foreground = tokens?.color?.primaryText ?? '#ffffff';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="${background}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="38" font-weight="700" fill="${foreground}">${initial}</text></svg>`;

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * A description for a page whose owner has not written one.
 *
 * Never returns undefined. A page with no `<meta name="description">` is a
 * page whose snippet the search engine writes for you out of whatever text it
 * finds first — and Lighthouse scores it as a defect, which is how this was
 * found: category pages inherited nothing, because a child route that omits
 * `description` does not fall back to the layout's.
 *
 * `parts` are tried in order; the last one should always be a generated
 * sentence built from the store's own data.
 */
export function describe(...parts) {
  for (const part of parts) {
    if (typeof part === 'string' && part.trim()) return part.trim().slice(0, 300);
  }
  return undefined;
}

/** Strips tags from CMS HTML so a page's own content can seed its description. */
export function textFromHtml(html, limit = 160) {
  if (!html) return '';
  const text = String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/**
 * Shared Open Graph + Twitter block. Twitter falls back to the OG values for
 * everything it can, so a page only ever has to describe itself once.
 */
export function socialMeta({ title, description, url, images, type = 'website', siteName }) {
  const imageList = (Array.isArray(images) ? images : [images]).filter(Boolean);

  return {
    openGraph: {
      type,
      title,
      description,
      url,
      siteName,
      images: imageList.length ? imageList : undefined,
    },
    twitter: {
      card: imageList.length ? 'summary_large_image' : 'summary',
      title,
      description,
      images: imageList.length ? imageList.map((image) => image.url ?? image) : undefined,
    },
  };
}

/**
 * `hreflang` alternates for one path, absolute on the canonical origin.
 *
 * The default language answers both the bare path and `x-default`; every other
 * enabled language answers its own prefix. A single-language store gets no
 * alternates at all rather than a self-referencing one.
 */
export function languageAlternates({ origin, path, langs, defaultLang }) {
  if (!langs || langs.length < 2) return undefined;

  const clean = path === '/' ? '' : path;
  const alternates = {};
  for (const lang of langs) {
    const prefix = lang.code === defaultLang ? '' : `/${lang.code}`;
    alternates[lang.code] = `${origin}${prefix}${clean}` || origin;
  }
  alternates['x-default'] = `${origin}${clean}` || origin;
  return alternates;
}

/* --------------------------------------------------------------- JSON-LD */

/**
 * Structured data is emitted as a plain `<script>` rather than through a
 * library. The escaping matters: `<` inside a JSON string would end the script
 * element early, which is an XSS vector wherever the data includes anything a
 * shopper or a client admin typed (product names, descriptions).
 */
export function jsonLdScript(data) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

export function organizationLd({ company, origin, logoUrl, social }) {
  const sameAs = Object.values(social ?? {}).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${origin}/#organization`,
    name: company.name,
    url: origin,
    ...(logoUrl ? { logo: logoUrl } : {}),
    ...(company.email ? { email: company.email } : {}),
    ...(company.phone ? { telephone: company.phone } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function webSiteLd({ company, origin }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${origin}/#website`,
    name: company.name,
    url: origin,
    publisher: { '@id': `${origin}/#organization` },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${origin}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/**
 * A product with its offer. `availability` is derived from the variant the
 * shopper would actually buy, and `priceCurrency` is only emitted when the
 * store has set a currency — an offer with a price and no currency is invalid
 * structured data, and guessing one would be worse than omitting the offer.
 */
export function productLd({ product, origin, url, currency }) {
  const variant = product.defaultVariant;
  const price = variant?.salePrice ?? variant?.price ?? null;
  const inStock = product.variants?.some((row) => row.inStock) ?? false;

  const offers =
    price !== null && currency
      ? {
          '@type': 'Offer',
          url,
          price: String(price),
          priceCurrency: currency,
          availability: inStock
            ? 'https://schema.org/InStock'
            : 'https://schema.org/OutOfStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller: { '@id': `${origin}/#organization` },
        }
      : undefined;

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    '@id': `${url}#product`,
    name: product.name,
    url,
    ...(product.shortDesc || product.metaDesc
      ? { description: product.metaDesc || product.shortDesc }
      : {}),
    ...(product.images?.length
      ? { image: product.images.map((image) => absolute(origin, image.url)) }
      : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(variant?.sku ? { sku: variant.sku } : {}),
    ...(offers ? { offers } : {}),
  };
}

export function breadcrumbLd({ origin, trail }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: absolute(origin, crumb.path),
    })),
  };
}
