import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { ProductDetail } from '../../../components/ProductDetail.jsx';
import { JsonLd } from '../../../components/JsonLd.jsx';
import {
  absolute,
  breadcrumbLd,
  canonicalOrigin,
  languageAlternates,
  pageTitle,
  productLd,
  socialMeta,
} from '../../../lib/seo.js';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  const res = await apiGet(`/shop/products/${slug}`, { searchParams: { lang: ctx.lang } });
  if (!res.data?.product || !ctx.company) return {};

  const product = res.data.product;
  const origin = await canonicalOrigin(ctx.company);
  const path = `/products/${product.slug}`;
  const url = `${origin}${path}`;

  // The layout's title template turns this into the brief's `{name} | {store}`.
  // Social titles get no template applied to them, so they build it themselves.
  const title = product.metaTitle || product.name;
  const description = product.metaDesc || product.shortDesc || undefined;

  return {
    title,
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
      title: pageTitle(title, ctx.company.name),
      description,
      url,
      siteName: ctx.company.name,
      images: product.images?.[0]?.url
        ? [
            {
              url: absolute(origin, product.images[0].url),
              alt: product.images[0].alt || product.name,
            },
          ]
        : undefined,
    }),
  };
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  if (!ctx.company) return null;

  const res = await apiGet(`/shop/products/${slug}`, {
    revalidate: 60,
    searchParams: { lang: ctx.lang },
  });
  if (res.notFound || !res.data?.product) notFound();

  const product = res.data.product;
  const origin = await canonicalOrigin(ctx.company);
  const url = `${origin}/products/${product.slug}`;

  return (
    <>
      <JsonLd data={productLd({ product, origin, url, currency: ctx.currency })} />
      <JsonLd
        data={breadcrumbLd({
          origin,
          trail: [
            { name: ctx.company.name, path: `${ctx.hrefBase}/` },
            { name: product.name, path: `${ctx.hrefBase}/products/${product.slug}` },
          ],
        })}
      />
      <ProductDetail product={product} currency={ctx.currency} />
    </>
  );
}
