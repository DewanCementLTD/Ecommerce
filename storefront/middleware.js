import { NextResponse } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:8003';

/**
 * Language prefix handling, and the canonical-domain redirect.
 *
 * ## Language
 *
 * `/ar/cats/beef` is rewritten to `/cats/beef` with the language carried in a
 * request header, so every page has exactly one implementation instead of one
 * per language. The default language is served at both `/` and `/{code}/`, and
 * the bare path is the canonical one.
 *
 * A first segment of two or three letters is treated as a language code. Every
 * real page route prefix in this app is longer (cats, colls, products, pages,
 * search), so there is no ambiguity there; an unknown code simply falls
 * through to the store's default, because the API ignores languages it does
 * not know. `api` is the one three-letter exception — Phase 2's route
 * handlers (cart/checkout/account) live under `/api/*`, which this same
 * heuristic would otherwise rewrite to `/*` with `api` read as a language,
 * 404ing every one of them. Excluded via `config.matcher` below, the same
 * way `_next`/`fonts`/`favicon.ico` already are — this middleware never runs
 * for those paths at all.
 *
 * ## Canonical domain
 *
 * A company can own several hosts; exactly one is flagged primary. Requests on
 * any other one are 301'd to the primary, path and query intact, so a store's
 * ranking signals never split across its own domains. The tags say the same
 * thing independently (`canonicalOrigin()` in lib/seo.js, and `noindex` on a
 * secondary host) because a crawler that has not followed the redirect yet must
 * not be told a duplicate is canonical.
 */
const LANG_SEGMENT = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

/**
 * host → primary host, cached in worker memory. The same 5 minutes the API
 * caches its own host→company lookup for (00-SYSTEM-DESIGN.md §7): a domain
 * change takes at most that long to take effect, and in exchange a request on
 * an already-seen host costs no API call at all.
 *
 * A failed lookup is cached as "no opinion" rather than retried per request —
 * if the API is down, the site must still serve, not redirect-loop or stall.
 */
const PRIMARY_TTL_MS = 5 * 60 * 1000;
const primaryHosts = new Map();

/** Same normalization the API's tenant resolver uses: no port, no `www.`. */
function normalizeHost(rawHost) {
  const first = (rawHost ?? '').split(',')[0].trim().toLowerCase();
  const withoutPort = first.split(':')[0];
  return withoutPort.startsWith('www.') ? withoutPort.slice(4) : withoutPort;
}

async function primaryHostFor(host) {
  const cached = primaryHosts.get(host);
  if (cached && cached.expires > Date.now()) return cached.value;

  let value = null;
  try {
    const res = await fetch(new URL('/storefront/company', API_URL), {
      headers: { 'X-Forwarded-Host': host },
      cache: 'no-store',
    });
    if (res.ok) {
      const body = await res.json();
      value = body?.company?.primaryHost ?? null;
    }
  } catch {
    // API unreachable: no opinion, serve the request as-is.
  }

  primaryHosts.set(host, { value, expires: Date.now() + PRIMARY_TTL_MS });
  return value;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = normalizeHost(rawHost);
  const primary = host ? await primaryHostFor(host) : null;

  if (primary && primary !== host) {
    const url = request.nextUrl.clone();
    url.hostname = primary;
    return NextResponse.redirect(url, 301);
  }

  const [, first, ...rest] = pathname.split('/');
  const headers = new Headers(request.headers);

  if (!first || !LANG_SEGMENT.test(first)) {
    // No language prefix. The path still has to be published for the layout:
    // Next 15 gives a layout no way to read the current pathname, and the
    // hreflang alternates and language switcher both need it.
    headers.set('x-sf-path', pathname);
    return NextResponse.next({ request: { headers } });
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${rest.join('/')}`;

  headers.set('x-sf-lang', first.toLowerCase());
  headers.set('x-sf-path', url.pathname);

  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ['/((?!api|_next|fonts|favicon.ico).*)'],
};
