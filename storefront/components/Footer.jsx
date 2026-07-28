import Link from 'next/link';
import { menuHref } from './Header.jsx';

/**
 * Two footer variants, selected by `tokens.layout.footer`. No payment logos and
 * no delivery promises: orders are manual/COD in this system, and inventing
 * either would be a lie printed on every page.
 */
export function Footer({ company, menu, tokens, hrefBase }) {
  const variant = tokens.layout?.footer ?? 'columns';
  const items = menu?.items ?? [];
  const year = new Date().getFullYear();

  if (variant === 'compact') {
    return (
      <footer className="mt-20 border-t border-line py-10">
        <div className="sf-container flex flex-col items-center gap-4 text-center">
          <p className="font-display text-lg font-bold">{company.name}</p>
          {items.length ? (
            <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={menuHref(item, hrefBase)} className="text-sm text-muted hover:text-accent">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted">
            &copy; {year} {company.name}
          </p>
        </div>
      </footer>
    );
  }

  return (
    <footer className="mt-20 border-t border-line bg-surface py-14">
      <div className="sf-container grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <p className="font-display text-xl font-extrabold">{company.name}</p>
          <p className="mt-3 max-w-prose text-sm text-muted">
            Order online and pay on delivery. Everything is prepared fresh for each order.
          </p>
        </div>

        {items.length ? (
          <nav aria-label="Footer">
            <h2 className="text-sm font-semibold uppercase tracking-wide">Information</h2>
            <ul className="mt-4 space-y-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={menuHref(item, hrefBase)} className="text-sm text-muted hover:text-accent">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide">Get in touch</h2>
          <ul className="mt-4 space-y-2 text-sm text-muted">
            {company.email ? (
              <li>
                <a href={`mailto:${company.email}`} className="hover:text-accent">
                  {company.email}
                </a>
              </li>
            ) : null}
            {company.phone ? (
              <li>
                <a href={`tel:${company.phone}`} className="hover:text-accent">
                  {company.phone}
                </a>
              </li>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="sf-container mt-12 border-t border-line pt-6">
        <p className="text-xs text-muted">
          &copy; {year} {company.name}
        </p>
      </div>
    </footer>
  );
}
