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
