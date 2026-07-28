import { headers } from 'next/headers';
import './globals.css';
import { loadStore, langBase } from '../lib/store.js';
import { tokensToCssVars, DEFAULT_TOKENS } from '../lib/theme.js';
import { Header } from '../components/Header.jsx';
import { Footer } from '../components/Footer.jsx';
import { CartDrawer } from '../components/CartDrawer.jsx';
import { StoreUnavailable, StoreNotFound } from '../components/Status.jsx';
import { CartProvider } from '../lib/CartContext.jsx';
import { AccountProvider } from '../lib/AccountContext.jsx';
import { ToastProvider } from '../lib/ToastContext.jsx';
import { JsonLd } from '../components/JsonLd.jsx';
import {
  absolute,
  canonicalOrigin,
  languageAlternates,
  organizationLd,
  socialMeta,
  webSiteLd,
} from '../lib/seo.js';

export const dynamic = 'force-dynamic';

/** Per-store metadata: the title and description come from the database. */
export async function generateMetadata() {
  const lang = await currentLang();
  const store = await loadStore({ lang });
  if (!store.company) {
    // An unknown domain is a 404 page, not a page a crawler should keep.
    return { title: 'Store', robots: { index: false, follow: false } };
  }

  const path = (await currentPath()) || '/';
  const { company } = store;

  /**
   * Absolute URLs everywhere, on the store's *primary* domain. A relative
   * hreflang is not a valid alternate and gets ignored; a canonical pointing at
   * whichever secondary domain the visitor happened to use would split the
   * store's ranking signals across its own domains.
   */
  const origin = await canonicalOrigin(company);
  const metadataBase = new URL(origin);
  const canonical = `${origin}${path === '/' ? '' : path}` || origin;

  const title = company.seoTitle || company.name;
  const description = company.seoDescription || `Shop online at ${company.name}.`;
  const ogImage = company.ogImageUrl ?? company.logoUrl;

  /**
   * A suspended store and a secondary domain both stay out of the index: the
   * first has nothing worth indexing, the second is a duplicate of the primary
   * (middleware.js 301s it, but the tag has to be right for the request that
   * has already been served).
   */
  const indexable = company.status === 'active' && company.isPrimaryHost !== false;

  return {
    metadataBase,
    title: { default: title, template: `%s | ${company.name}` },
    description,
    robots: indexable
      ? { index: true, follow: true }
      : { index: false, follow: false, googleBot: { index: false, follow: false } },
    alternates: {
      canonical,
      languages: languageAlternates({
        origin,
        path,
        langs: store.langs,
        defaultLang: store.defaultLang,
      }),
    },
    ...socialMeta({
      title,
      description,
      url: canonical,
      siteName: company.name,
      images: ogImage ? [{ url: absolute(origin, ogImage) }] : undefined,
    }),
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

  // Site-wide structured data. Emitted once in the layout so every page carries
  // it; page-level types (Product, BreadcrumbList) reference it by @id.
  const origin = await canonicalOrigin(company);
  const siteLd = [
    organizationLd({
      company,
      origin,
      logoUrl: company.logoUrl ? absolute(origin, company.logoUrl) : null,
      social: company.social,
    }),
    webSiteLd({ company, origin }),
  ];

  return (
    <html lang={lang} dir={dir} style={tokensToCssVars(tokens)}>
      <body className="min-h-screen bg-bg text-ink antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-ink"
        >
          Skip to content
        </a>

        {siteLd.map((data) => (
          <JsonLd key={data['@type']} data={data} />
        ))}

        <ToastProvider>
          <AccountProvider>
            <CartProvider>
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

              <CartDrawer hrefBase={base} currency={company.currency} />
            </CartProvider>
          </AccountProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
