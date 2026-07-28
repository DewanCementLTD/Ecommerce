import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';

/**
 * Tag-based revalidation, called by the API after any write that changes what
 * a store's pages should say (see `api/src/lib/revalidate.js`).
 *
 * Every storefront read is tagged `sf:{host}` (lib/api.js), so dropping that
 * one tag drops every cached response for that store — its company payload,
 * menus, home sections, category listings and product pages alike. Coarser
 * than tagging per entity, and deliberately so: the API cannot know which of
 * this store's cached pages embedded the product that just changed, and a
 * store that has just been edited is a store whose next page load can afford
 * to be uncached.
 *
 * Authentication is a shared secret, not a session: the caller is another
 * server, and there is no user involved. With no secret configured the route
 * refuses everything rather than defaulting to open — an unauthenticated
 * cache-busting endpoint is a free denial-of-service against every store on
 * the box.
 */
export async function POST(request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get('x-revalidate-secret') !== secret) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const hosts = Array.isArray(body?.hosts) ? body.hosts : [];
  if (hosts.length === 0) {
    return NextResponse.json({ error: 'NO_HOSTS' }, { status: 400 });
  }

  for (const host of hosts) {
    revalidateTag(`sf:${String(host).toLowerCase()}`);
  }

  return NextResponse.json({ revalidated: hosts.length });
}
