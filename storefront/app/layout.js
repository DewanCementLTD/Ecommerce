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
  const store = await loadStore({ lang: await currentLang() });
  if (!store.company) return { title: 'Store' };

  return {
    title: { default: store.company.name, template: `%s · ${store.company.name}` },
    description: store.company.seoDescription ?? undefined,
    robots: { index: true, follow: true },
  };
}

async function currentLang() {
  const headersList = await headers();
  return headersList.get('x-sf-lang') ?? null;
}

async function currentPath() {
  const headersList = await headers();
  // Set by Next for every request; used to build the language switcher's links.
  return headersList.get('x-invoke-path') ?? headersList.get('x-matched-path') ?? '';
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
  const pathAfterLang = (await currentPath()).replace(/^\/[a-z]{2,3}(-[a-z0-9]{2,8})?(?=\/|$)/i, '');

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
