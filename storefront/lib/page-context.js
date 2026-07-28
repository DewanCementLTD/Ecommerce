import { headers } from 'next/headers';
import { loadStore, langBase } from './store.js';

/**
 * Every page needs the same four things: the resolved store, the language, the
 * link prefix for that language, and the currency. One helper so no page has to
 * remember the language plumbing.
 */
export async function pageContext() {
  const headersList = await headers();
  const lang = headersList.get('x-sf-lang') ?? null;
  const store = await loadStore({ lang });

  return {
    ...store,
    hrefBase: store.company ? langBase(store.lang, store.defaultLang) : '',
    currency: store.company?.currency ?? null,
  };
}

/**
 * The current query string, read from the header `middleware.js` publishes
 * rather than from Next's `searchParams` prop.
 *
 * Using the prop wraps the route in a Suspense boundary and pushes all of its
 * metadata out of `<head>` (see the note in middleware.js). Same values, same
 * dynamic-rendering behaviour, without that side effect.
 */
export async function pageQuery() {
  const headersList = await headers();
  return Object.fromEntries(new URLSearchParams(headersList.get('x-sf-query') ?? ''));
}
