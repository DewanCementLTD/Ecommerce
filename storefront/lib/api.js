import { headers } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:8003';

/**
 * Every storefront fetch forwards the incoming Host, because that header is the
 * only thing that tells the API which store is being asked for. Nothing here
 * ever sends a company id.
 *
 * Two layers of caching sit under this one call. `revalidate` is Next's own
 * time-based window, and `tags` is what lets the API cut that window short:
 * every response is tagged `sf:{host}`, and `app/api/revalidate/route.js`
 * drops that tag when the API reports a write for that store. The Redis layer
 * from `00-SYSTEM-DESIGN.md §7` lives on the far side of this call, inside the
 * API.
 *
 * The host is part of the tag and of the request, never of the URL — which is
 * why two stores asking for `/shop/products` do not share a cache entry: Next
 * keys the fetch cache on the request headers as well as the URL.
 */
export async function apiGet(path, { revalidate = 60, searchParams, tags = [] } = {}) {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';

  const url = new URL(path, API_URL);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: { 'X-Forwarded-Host': host },
    next: { revalidate, tags: [`sf:${host.split(':')[0].toLowerCase()}`, ...tags] },
  });

  if (res.status === 503) return { suspended: true };
  if (res.status === 404) return { notFound: true };
  if (!res.ok) return { error: true, status: res.status };

  return { data: await res.json() };
}

export { mediaUrl, mediaSrcSet } from './media.js';
