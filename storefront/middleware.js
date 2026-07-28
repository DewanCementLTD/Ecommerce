import { NextResponse } from 'next/server';

/**
 * Language prefix handling.
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
 */
const LANG_SEGMENT = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

export function middleware(request) {
  const { pathname } = request.nextUrl;
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
