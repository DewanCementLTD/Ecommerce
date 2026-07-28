import { apiGet } from '../../lib/api.js';
import { pageContext } from '../../lib/page-context.js';
import { ProductGrid, EmptyState, Pagination, Button } from '../../components/ui.jsx';

export const metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }) {
  const query = await searchParams;
  const ctx = await pageContext();
  if (!ctx.company) return null;

  const term = (query.q ?? '').trim();

  if (!term) {
    return (
      <div className="sf-container py-16">
        <EmptyState
          title="What are you looking for?"
          body="Search by product name, brand, or the code on the label."
          action={<Button href={ctx.hrefBase || '/'}>Browse everything</Button>}
        />
      </div>
    );
  }

  const res = await apiGet('/shop/search', {
    revalidate: 30,
    searchParams: { q: term, page: query.page, lang: ctx.lang },
  });
  const results = res.data ?? { rows: [], total: 0, page: 1, pageSize: 24 };

  return (
    <div className="sf-container py-8 md:py-12">
      <header className="mb-8">
        <h1>Search</h1>
        <p className="mt-2 text-muted">
          {results.total} {results.total === 1 ? 'result' : 'results'} for &ldquo;{term}&rdquo;
        </p>
      </header>

      {results.rows.length === 0 ? (
        <EmptyState
          title="Nothing matched that search"
          body="Try a shorter word, or a different spelling. You can also browse the categories in the menu."
          action={<Button href={ctx.hrefBase || '/'}>Browse everything</Button>}
        />
      ) : (
        <ProductGrid products={results.rows} currency={ctx.currency} hrefBase={ctx.hrefBase} />
      )}

      <Pagination
        page={results.page}
        pageSize={results.pageSize}
        total={results.total}
        basePath={`${ctx.hrefBase}/search`}
        searchParams={{ q: term }}
      />
    </div>
  );
}
