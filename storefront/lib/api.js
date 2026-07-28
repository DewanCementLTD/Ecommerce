import { headers } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/**
 * Every storefront fetch forwards the incoming Host, because that header is the
 * only thing that tells the API which store is being asked for. Nothing here
 * ever sends a company id.
 *
 * `revalidate` uses Next's own cache. The Redis layer from
 * 00-SYSTEM-DESIGN.md §7 is Phase 3, Task 2 — this is the framework-level
 * caching that comes with SSR, not a second cache invented early.
 */
export async function apiGet(path, { revalidate = 60, searchParams } = {}) {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';

  const url = new URL(path, API_URL);
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  const res = await fetch(url, {
    headers: { 'X-Forwarded-Host': host },
    next: { revalidate },
  });

  if (res.status === 503) return { suspended: true };
  if (res.status === 404) return { notFound: true };
  if (!res.ok) return { error: true, status: res.status };

  return { data: await res.json() };
}

export { mediaUrl, mediaSrcSet } from './media.js';
