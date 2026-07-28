import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { Sections } from '../../../components/sections.jsx';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  const res = await apiGet(`/shop/pages/${slug}`, { searchParams: { lang: ctx.lang } });
  if (!res.data?.page) return {};
  return {
    title: res.data.page.metaTitle || res.data.page.title,
    description: res.data.page.metaDesc || undefined,
  };
}

/** A CMS page is its rich content, then any sections arranged beneath it. */
export default async function CmsPage({ params }) {
  const { slug } = await params;
  const ctx = await pageContext();
  if (!ctx.company) return null;

  const res = await apiGet(`/shop/pages/${slug}`, {
    revalidate: 300,
    searchParams: { lang: ctx.lang },
  });
  if (res.notFound || !res.data?.page) notFound();

  const { page, sections } = res.data;

  return (
    <article className="py-10 md:py-16">
      <div className="sf-container">
        <h1 className="max-w-prose">{page.title}</h1>
        {page.content ? (
          <div
            className="mt-6 max-w-prose space-y-4 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: page.content }}
          />
        ) : null}
      </div>
      <Sections sections={sections} hrefBase={ctx.hrefBase} currency={ctx.currency} />
    </article>
  );
}
