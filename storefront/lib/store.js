import { apiGet } from './api.js';
import { normalizeTokens, dirFor } from './theme.js';

/**
 * Everything the chrome needs, in one place: the resolved company, its theme,
 * its menus, and the language in play. Called by the layout and by pages that
 * need the currency or the language list.
 *
 * Returns `{ suspended }` or `{ notFound }` rather than throwing, so the layout
 * can render the maintenance or unknown-domain page instead of an error.
 */
export async function loadStore({ lang } = {}) {
  const company = await apiGet('/storefront/company', { revalidate: 60 });
  if (company.suspended) return { suspended: true };
  if (company.notFound || company.error) return { notFound: true };

  const tokens = normalizeTokens(company.data.company.theme);
  const defaultLang = company.data.company.defaultLang ?? 'en';
  const activeLang = lang ?? defaultLang;

  const [menus, langs] = await Promise.all([
    apiGet('/shop/menus', { revalidate: 300, searchParams: { lang: activeLang } }),
    apiGet('/shop/langs', { revalidate: 300 }),
  ]);

  return {
    company: company.data.company,
    tokens,
    defaultLang,
    lang: activeLang,
    dir: dirFor(activeLang),
    menus: menus.data?.menus ?? { header: null, footer: null },
    langs: langs.data?.langs ?? [],
  };
}

/**
 * The path prefix for links in the current language. The default language is
 * served at both `/` and `/{code}/`, and its canonical form is the bare path —
 * so the prefix is empty for the default and `/{code}` for everything else.
 */
export function langBase(lang, defaultLang) {
  return !lang || lang === defaultLang ? '' : `/${lang}`;
}
