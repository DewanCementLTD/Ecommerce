import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { ProductDetail } from '../../../components/ProductDetail.jsx';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  const res = await apiGet(`/shop/products/${slug}`, { searchParams: { lang: ctx.lang } });
  if (!res.data?.product) return {};

  const product = res.data.product;
  return {
    title: product.metaTitle || product.name,
    description: product.metaDesc || product.shortDesc || undefined,
    openGraph: {
      title: product.metaTitle || product.name,
      description: product.metaDesc || product.shortDesc || undefined,
      images: product.images?.[0]?.url ? [product.images[0].url] : undefined,
    },
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

  return (
    <ProductDetail
      product={res.data.product}
      currency={ctx.currency}
      storeName={ctx.company.name}
    />
  );
}
