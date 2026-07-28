import Link from 'next/link';
import { mediaUrl, mediaSrcSet } from '../lib/media.js';

/**
 * Shared primitives. Every one uses logical properties (ms-/me-/ps-/pe-/start/
 * end) rather than left/right, so the whole layout mirrors when dir="rtl"
 * without a single RTL-specific rule.
 */

/** Responsive image from a media path, with the widths the API generates. */
export function Media({ path, alt, className = '', sizes = '100vw', priority = false, ratio = 'aspect-[4/3]' }) {
  if (!path) {
    return (
      <div className={`${ratio} w-full bg-surface ${className}`} aria-hidden="true" />
    );
  }
  return (
    <img
      src={mediaUrl(path, 640)}
      srcSet={mediaSrcSet(path)}
      sizes={sizes}
      alt={alt ?? ''}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={`${ratio} w-full object-cover ${className}`}
    />
  );
}

export function Price({ price, salePrice, currency, className = '' }) {
  const format = (value) =>
    new Intl.NumberFormat(undefined, {
      style: currency ? 'currency' : 'decimal',
      currency: currency || undefined,
      minimumFractionDigits: 2,
    }).format(value ?? 0);

  const onSale = salePrice !== null && salePrice !== undefined && salePrice < price;

  return (
    <p className={`flex flex-wrap items-baseline gap-2 ${className}`}>
      <span className={`font-semibold ${onSale ? 'text-sale' : ''}`}>
        {format(onSale ? salePrice : price)}
      </span>
      {onSale ? (
        <>
          <span className="text-sm text-muted line-through">{format(price)}</span>
          <span className="sr-only">on sale, was {format(price)}</span>
        </>
      ) : null}
    </p>
  );
}

export function ProductCard({ product, currency, hrefBase = '' }) {
  return (
    <article className="group">
      <Link
        href={`${hrefBase}/products/${product.slug}`}
        className="block overflow-hidden rounded-lg bg-surface"
      >
        <div className="overflow-hidden">
          <Media
            path={product.image?.url}
            alt={product.image?.alt ?? product.name}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        </div>
      </Link>
      <div className="mt-3 space-y-1">
        <h3 className="text-base font-semibold leading-snug">
          <Link href={`${hrefBase}/products/${product.slug}`} className="hover:text-accent">
            {product.name}
          </Link>
        </h3>
        {product.shortDesc ? (
          <p className="line-clamp-1 text-sm text-muted">{product.shortDesc}</p>
        ) : null}
        <Price price={product.price} salePrice={product.salePrice} currency={currency} />
        {!product.inStock ? (
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Out of stock</p>
        ) : null}
      </div>
    </article>
  );
}

export function ProductGrid({ products, currency, hrefBase = '', label = 'Products' }) {
  return (
    <section aria-labelledby="product-grid-heading">
      {/*
        Card titles are h3 — the right visual weight, and the right level *if*
        something sits between them and the page's h1. Without this heading the
        outline jumped h1 → h3, which Lighthouse flags ("heading elements are
        not in a sequentially-descending order") and which leaves a screen
        reader with a grid of items belonging to nothing.
      */}
      <h2 id="product-grid-heading" className="sr-only">
        {label}
      </h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4 md:grid-cols-3">
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} currency={currency} hrefBase={hrefBase} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function SectionHeading({ title, action }) {
  if (!title && !action) return null;
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      {title ? <h2>{title}</h2> : <span />}
      {action}
    </div>
  );
}

/** Empty states invite an action; they never say "No data". */
export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      {body ? <p className="mx-auto mt-2 max-w-prose text-muted">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4 md:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index} className="space-y-3">
          <div className="sf-skeleton aspect-[4/3] w-full rounded-lg" />
          <div className="sf-skeleton h-4 w-3/4 rounded-sm" />
          <div className="sf-skeleton h-4 w-1/3 rounded-sm" />
        </li>
      ))}
    </ul>
  );
}

export function Button({ href, children, variant = 'primary', className = '', ...rest }) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-pill px-5 py-2.5 text-sm font-semibold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    primary: 'bg-primary text-primary-ink hover:bg-accent',
    outline: 'border border-line bg-transparent text-ink hover:border-accent hover:text-accent',
    quiet: 'text-ink underline underline-offset-4 hover:text-accent',
  };
  const classes = `${base} ${variants[variant]} ${className}`;

  if (href) {
    return (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}

export function Pagination({ page, pageSize, total, basePath, searchParams = {} }) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;

  const href = (target) => {
    const params = new URLSearchParams(
      Object.entries(searchParams).filter(([, value]) => value !== undefined && value !== null && value !== ''),
    );
    if (target > 1) params.set('page', String(target));
    else params.delete('page');
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  return (
    <nav className="mt-12 flex items-center justify-center gap-2" aria-label="Pagination">
      {page > 1 ? (
        <Button href={href(page - 1)} variant="outline">
          Previous
        </Button>
      ) : null}
      <span className="px-4 text-sm text-muted">
        Page {page} of {pages}
      </span>
      {page < pages ? (
        <Button href={href(page + 1)} variant="outline">
          Next
        </Button>
      ) : null}
    </nav>
  );
}
