import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { ProductGrid, EmptyState, Pagination, Button } from '../../../components/ui.jsx';
import { JsonLd } from '../../../components/JsonLd.jsx';
import {
  absolute,
  breadcrumbLd,
  canonicalOrigin,
  languageAlternates,
  pageTitle,
  socialMeta,
} from '../../../lib/seo.js';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  const res = await apiGet(`/shop/colls/${slug}`, { searchParams: { lang: ctx.lang } });
  if (!res.data || !ctx.company) return {};

  const { coll } = res.data;
  const origin = await canonicalOrigin(ctx.company);
  const path = `/colls/${coll.slug}`;
  const url = `${origin}${path}`;
  const description = coll.descr || undefined;

  return {
    title: coll.name,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates({
        origin,
        path,
        langs: ctx.langs,
        defaultLang: ctx.defaultLang,
      }),
    },
    ...socialMeta({
      title: pageTitle(coll.name, ctx.company.name),
      description,
      url,
      siteName: ctx.company.name,
      images: coll.image?.url
        ? [{ url: absolute(origin, coll.image.url), alt: coll.name }]
        : undefined,
    }),
  };
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
  const origin = await canonicalOrigin(ctx.company);

  return (
    <div className="sf-container py-8 md:py-12">
      <JsonLd
        data={breadcrumbLd({
          origin,
          trail: [
            { name: ctx.company.name, path: `${ctx.hrefBase}/` },
            { name: coll.name, path: `${ctx.hrefBase}/colls/${coll.slug}` },
          ],
        })}
      />

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
