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
 * real route prefix in this app is longer (cats, colls, products, pages,
 * search), so there is no ambiguity; an unknown code simply falls through to
 * the store's default, because the API ignores languages it does not know.
 */
const LANG_SEGMENT = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

export function middleware(request) {
  const { pathname } = request.nextUrl;
  const [, first, ...rest] = pathname.split('/');

  if (!first || !LANG_SEGMENT.test(first)) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = `/${rest.join('/')}`;

  const headers = new Headers(request.headers);
  headers.set('x-sf-lang', first.toLowerCase());

  return NextResponse.rewrite(url, { request: { headers } });
}

export const config = {
  matcher: ['/((?!_next|fonts|favicon.ico).*)'],
};
