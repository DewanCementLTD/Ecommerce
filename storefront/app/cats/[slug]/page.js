import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { ProductGrid, EmptyState, Pagination, Button } from '../../../components/ui.jsx';
import { Filters } from '../../../components/Filters.jsx';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  const res = await apiGet(`/shop/cats/${slug}`, { searchParams: { lang: ctx.lang } });
  if (!res.data) return {};
  return {
    title: res.data.cat.metaTitle || res.data.cat.name,
    description: res.data.cat.metaDesc || undefined,
  };
}

export default async function CategoryPage({ params, searchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await pageContext();
  if (!ctx.company) return null;

  const res = await apiGet(`/shop/cats/${slug}`, {
    revalidate: 60,
    searchParams: { lang: ctx.lang, page: query.page, sort: query.sort, dir: query.dir },
  });

  if (res.notFound || !res.data) notFound();

  const { cat, products } = res.data;
  const filtered = applyFilters(products.rows, query);

  return (
    <div className="sf-container py-8 md:py-12">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted">
        <ol className="flex items-center gap-2">
          <li>
            <a href={ctx.hrefBase || '/'} className="hover:text-accent">
              Home
            </a>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="text-ink">
            {cat.name}
          </li>
        </ol>
      </nav>

      <header className="mb-8 max-w-prose">
        <h1>{cat.name}</h1>
        {cat.descr ? <p className="mt-3 text-muted">{cat.descr}</p> : null}
      </header>

      <Filters basePath={`${ctx.hrefBase}/cats/${slug}`} query={query} total={products.total} />

      {filtered.length === 0 ? (
        <EmptyState
          title="Nothing here just yet"
          body="No products in this category match what you are looking for. Try clearing the filters, or browse the rest of the shop."
          action={<Button href={ctx.hrefBase || '/'}>Browse everything</Button>}
        />
      ) : (
        <ProductGrid products={filtered} currency={ctx.currency} hrefBase={ctx.hrefBase} />
      )}

      <Pagination
        page={products.page}
        pageSize={products.pageSize}
        total={products.total}
        basePath={`${ctx.hrefBase}/cats/${slug}`}
        searchParams={query}
      />
    </div>
  );
}

/**
 * Price and availability are filtered over the page the API returned, rather
 * than pushed into the catalog query. Sorting and pagination are the API's job;
 * turning every filter into another SQL predicate is Phase 3 performance work,
 * and doing it here keeps the shop endpoints one shape for every caller.
 */
function applyFilters(rows, query) {
  let result = rows;
  if (query.inStock === '1') result = result.filter((row) => row.inStock);
  if (query.min) result = result.filter((row) => (row.salePrice ?? row.price ?? 0) >= Number(query.min));
  if (query.max) result = result.filter((row) => (row.salePrice ?? row.price ?? 0) <= Number(query.max));
  return result;
}
