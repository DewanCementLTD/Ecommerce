import { notFound } from 'next/navigation';
import { apiGet } from '../../../lib/api.js';
import { pageContext } from '../../../lib/page-context.js';
import { Sections } from '../../../components/sections.jsx';
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
  const res = await apiGet(`/shop/pages/${slug}`, { searchParams: { lang: ctx.lang } });
  if (!res.data?.page || !ctx.company) return {};

  const { page } = res.data;
  const origin = await canonicalOrigin(ctx.company);
  const path = `/pages/${page.slug}`;
  const url = `${origin}${path}`;

  const title = page.metaTitle || page.title;
  const description = page.metaDesc || undefined;

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
      type: 'article',
      title: pageTitle(title, ctx.company.name),
      description,
      url,
      siteName: ctx.company.name,
      images: page.ogImage ? [{ url: absolute(origin, page.ogImage), alt: title }] : undefined,
    }),
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
  const origin = await canonicalOrigin(ctx.company);

  return (
    <article className="py-10 md:py-16">
      <JsonLd
        data={breadcrumbLd({
          origin,
          trail: [
            { name: ctx.company.name, path: `${ctx.hrefBase}/` },
            { name: page.title, path: `${ctx.hrefBase}/pages/${page.slug}` },
          ],
        })}
      />

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
