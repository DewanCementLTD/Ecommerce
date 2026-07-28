import { apiGet } from '../lib/api.js';
import { pageContext } from '../lib/page-context.js';
import { Sections } from '../components/sections.jsx';
import { EmptyState } from '../components/ui.jsx';

/**
 * The home page is whatever sections the owner arranged, in their order. One
 * API call returns the page and every section's data already resolved, so this
 * component does no fetching per section.
 */
export default async function HomePage() {
  const ctx = await pageContext();
  if (!ctx.company) return null; // layout already rendered the status page

  const home = await apiGet('/shop/home', {
    revalidate: 60,
    searchParams: { lang: ctx.lang },
  });

  const sections = home.data?.sections ?? [];

  if (sections.length === 0) {
    return (
      <div className="sf-container py-24">
        <EmptyState
          title={`Welcome to ${ctx.company.name}`}
          body="This store is being set up. Its home page will appear here as soon as the first sections are arranged."
        />
      </div>
    );
  }

  return (
    <div className="sf-reveal">
      {/*
        The home page's visual title is a banner image, so the document still
        needs a real h1 for screen readers and for search engines. Named after
        the store, from the database.
      */}
      <h1 className="sr-only">{ctx.company.name}</h1>
      <Sections sections={sections} hrefBase={ctx.hrefBase} currency={ctx.currency} />
    </div>
  );
}
