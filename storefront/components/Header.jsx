import Link from 'next/link';
import { mediaUrl } from '../lib/media.js';
import { CartButton } from './CartButton.jsx';

/**
 * Two header variants, chosen by `tokens.layout.header` — a value from the
 * database, never a per-store code branch. Both are the same data and the same
 * components; only the arrangement differs.
 */

function Logo({ company, hrefBase }) {
  return (
    <Link href={hrefBase || '/'} className="flex items-center gap-2.5">
      {company.logoUrl ? (
        <img
          src={mediaUrl(company.logoUrl, 320)}
          alt={company.name}
          className="h-9 w-auto max-w-[10rem] object-contain"
        />
      ) : (
        <span className="font-display text-lg font-extrabold tracking-tight">{company.name}</span>
      )}
    </Link>
  );
}

function NavLinks({ items, hrefBase, className = '' }) {
  if (!items?.length) return null;
  return (
    <ul className={`flex items-center gap-6 ${className}`}>
      {items.map((item) => (
        <li key={item.id} className="relative group">
          <Link
            href={menuHref(item, hrefBase)}
            className="inline-block py-2 text-sm font-medium hover:text-accent"
          >
            {item.label}
          </Link>
          {item.children?.length ? (
            <ul className="invisible absolute start-0 top-full z-20 min-w-48 rounded-md border border-line bg-bg p-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
              {item.children.map((child) => (
                <li key={child.id}>
                  <Link
                    href={menuHref(child, hrefBase)}
                    className="block rounded-sm px-3 py-2 text-sm hover:bg-surface hover:text-accent"
                  >
                    {child.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** menu_items store a pointer, not a URL, so links stay correct after a rename. */
export function menuHref(item, hrefBase = '') {
  switch (item.linkType) {
    case 'cat':
      return `${hrefBase}/cats/${item.targetSlug ?? item.linkId}`;
    case 'coll':
      return `${hrefBase}/colls/${item.targetSlug ?? item.linkId}`;
    case 'page':
      return `${hrefBase}/pages/${item.targetSlug ?? item.linkId}`;
    case 'product':
      return `${hrefBase}/products/${item.targetSlug ?? item.linkId}`;
    default:
      return item.url?.startsWith('http') ? item.url : `${hrefBase}${item.url ?? '/'}`;
  }
}

function SearchForm({ hrefBase, label }) {
  return (
    <form action={`${hrefBase}/search`} method="get" role="search" className="relative w-full">
      <label htmlFor="sf-search" className="sr-only">
        {label}
      </label>
      <input
        id="sf-search"
        type="search"
        name="q"
        placeholder={label}
        className="w-full rounded-pill border border-line bg-bg py-2 pe-4 ps-10 text-sm outline-none focus:border-accent"
      />
      <svg
        className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r="6" />
        <path d="m14 14 4 4" strokeLinecap="round" />
      </svg>
    </form>
  );
}

function LangSwitcher({ langs, currentLang, defaultLang, pathAfterLang }) {
  if (!langs || langs.length < 2) return null;

  const hrefFor = (code) => {
    const rest = pathAfterLang || '';
    return code === defaultLang ? rest || '/' : `/${code}${rest}`;
  };

  return (
    <nav aria-label="Language" className="flex items-center gap-1 text-sm">
      {langs.map((lang) => (
        <Link
          key={lang.code}
          href={hrefFor(lang.code)}
          hrefLang={lang.code}
          aria-current={lang.code === currentLang ? 'true' : undefined}
          className={`grid min-h-6 min-w-6 place-items-center rounded-sm px-2 py-1 uppercase ${
            lang.code === currentLang
              ? 'font-semibold text-ink underline underline-offset-4'
              : 'text-muted hover:text-ink'
          }`}
        >
          {lang.code}
        </Link>
      ))}
    </nav>
  );
}

export function Header({ company, menu, tokens, langs, lang, defaultLang, hrefBase, pathAfterLang }) {
  const variant = tokens.layout?.header ?? 'classic';
  const items = menu?.items ?? [];

  const shared = { langs, currentLang: lang, defaultLang, pathAfterLang };

  if (variant === 'centered') {
    return (
      <header className="border-b border-line">
        <div className="sf-container flex items-center justify-between gap-4 py-3 text-xs text-muted">
          <p className="hidden sm:block">{company.name}</p>
          <LangSwitcher {...shared} />
        </div>
        <div className="sf-container flex flex-col items-center gap-4 pb-5">
          <Logo company={company} hrefBase={hrefBase} />
          <div className="w-full max-w-md">
            <SearchForm hrefBase={hrefBase} label="Search products" />
          </div>
        </div>
        <div className="border-t border-line">
          <div className="sf-container flex items-center justify-between gap-4 overflow-x-auto py-1">
            <NavLinks items={items} hrefBase={hrefBase} />
            <CartButton label="Cart" />
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur">
      <div className="sf-container flex items-center gap-4 py-3">
        <Logo company={company} hrefBase={hrefBase} />
        <div className="hidden flex-1 md:block">
          <NavLinks items={items} hrefBase={hrefBase} className="justify-center" />
        </div>
        <div className="ms-auto flex items-center gap-2">
          <div className="hidden w-56 lg:block">
            <SearchForm hrefBase={hrefBase} label="Search products" />
          </div>
          <LangSwitcher {...shared} />
          <CartButton label="Cart" />
        </div>
      </div>
      <div className="sf-container pb-3 lg:hidden">
        <SearchForm hrefBase={hrefBase} label="Search products" />
      </div>
      <div className="sf-container overflow-x-auto pb-2 md:hidden">
        <NavLinks items={items} hrefBase={hrefBase} />
      </div>
    </header>
  );
}
