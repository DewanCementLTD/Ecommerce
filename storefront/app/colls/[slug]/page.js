import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { ProductGrid, EmptyState, Pagination, Button } from '../../../components/ui.jsx';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  const res = await apiGet(`/shop/colls/${slug}`, { searchParams: { lang: ctx.lang } });
  return res.data ? { title: res.data.coll.name } : {};
}

export default async function CollectionPage({ params, searchParams }) {
  const { slug } = await params;
  const query = await searchParams;
  const ctx = await pageContext();
  if (!ctx.company) return null;

  const res = await apiGet(`/shop/colls/${slug}`, {
    revalidate: 60,
    searchParams: { lang: ctx.lang, page: query.page },
  });
  if (res.notFound || !res.data) notFound();

  const { coll, products } = res.data;

  return (
    <div className="sf-container py-8 md:py-12">
      <header className="mb-8 max-w-prose">
        <h1>{coll.name}</h1>
        {coll.descr ? <p className="mt-3 text-muted">{coll.descr}</p> : null}
      </header>

      {products.rows.length === 0 ? (
        <EmptyState
          title="This collection is empty for now"
          body="Nothing has been added to it yet. There is plenty else to see in the shop."
          action={<Button href={ctx.hrefBase || '/'}>Browse everything</Button>}
        />
      ) : (
        <ProductGrid products={products.rows} currency={ctx.currency} hrefBase={ctx.hrefBase} />
      )}

      <Pagination
        page={products.page}
        pageSize={products.pageSize}
        total={products.total}
        basePath={`${ctx.hrefBase}/colls/${slug}`}
        searchParams={query}
      />
    </div>
  );
}
