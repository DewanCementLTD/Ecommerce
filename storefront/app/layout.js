import { headers } from 'next/headers';
import './globals.css';
import { loadStore, langBase } from '../lib/store.js';
import { tokensToCssVars, DEFAULT_TOKENS } from '../lib/theme.js';
import { Header } from '../components/Header.jsx';
import { Footer } from '../components/Footer.jsx';
import { StoreUnavailable, StoreNotFound } from '../components/Status.jsx';

export const dynamic = 'force-dynamic';

/** Per-store metadata: the title and description come from the database. */
export async function generateMetadata() {
  const lang = await currentLang();
  const store = await loadStore({ lang });
  if (!store.company) return { title: 'Store' };

  const path = (await currentPath()) || '/';

  /**
   * hreflang alternates have to be fully qualified — a relative href is not a
   * valid alternate and search engines ignore it. metadataBase is built from
   * the request's own host, so each store's tags name that store's domain
   * rather than anything hardcoded.
   */
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || 'localhost';
  const proto = headersList.get('x-forwarded-proto') || 'http';
  const metadataBase = new URL(`${proto}://${host}`);

  /**
   * hreflang alternates, so a crawler treats `/products/x` and `/ar/products/x`
   * as one product in two languages rather than duplicate content. The default
   * language is canonical at the bare path and also answers x-default.
   */
  const languages = {};
  for (const available of store.langs) {
    const prefix = langBase(available.code, store.defaultLang);
    languages[available.code] = `${prefix}${path === '/' ? '' : path}` || '/';
  }
  if (store.langs.length > 1) {
    languages['x-default'] = path;
  }

  return {
    metadataBase,
    title: { default: store.company.name, template: `%s · ${store.company.name}` },
    description: store.company.seoDescription ?? `Shop online at ${store.company.name}.`,
    robots: { index: true, follow: true },
    alternates: { canonical: path, languages },
  };
}

async function currentLang() {
  const headersList = await headers();
  return headersList.get('x-sf-lang') ?? null;
}

/** Published by middleware.js, already stripped of any language prefix. */
async function currentPath() {
  const headersList = await headers();
  return headersList.get('x-sf-path') ?? '/';
}

export default async function RootLayout({ children }) {
  const requestedLang = await currentLang();
  const store = await loadStore({ lang: requestedLang });

  // Unknown domain or suspended store: still a complete, styled page.
  if (store.suspended || store.notFound) {
    return (
      <html lang="en" dir="ltr">
        <body style={tokensToCssVars(DEFAULT_TOKENS)}>
          {store.suspended ? <StoreUnavailable /> : <StoreNotFound />}
        </body>
      </html>
    );
  }

  const { company, tokens, menus, langs, lang, defaultLang, dir } = store;
  const base = langBase(lang, defaultLang);
  const pathAfterLang = (await currentPath()).replace(/^\/$/, '');

  return (
    <html lang={lang} dir={dir} style={tokensToCssVars(tokens)}>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink"
        >
          Skip to content
        </a>

        <Header
          company={company}
          menu={menus.header}
          tokens={tokens}
          langs={langs}
          lang={lang}
          defaultLang={defaultLang}
          hrefBase={base}
          pathAfterLang={pathAfterLang}
        />

        <main id="main">{children}</main>

        <Footer company={company} menu={menus.footer} tokens={tokens} hrefBase={base} />
      </body>
    </html>
  );
}
