import { env } from '../config/env.js';
import { logger } from './logger.js';
import { cached, TTL } from './cache.js';
import { withPlatform } from '../db/pool.js';
import { listDomainsByCompany } from '../modules/platform/platform.repo.js';

/**
 * Tag-based revalidation of the Next.js storefront's fetch cache.
 *
 * The API owns the data; the storefront caches responses about it. When a
 * client saves a product, a section or a menu, both caches have to let go —
 * `lib/cache.js` handles ours, this handles theirs.
 *
 * **Tagged by host, not by company id.** The storefront's first call for any
 * request is the one that resolves which company the host belongs to, so at
 * tag-writing time it does not yet know an id; it does always know the host.
 * One tag per store (`sf:{host}`) also keeps this honest about how coarse the
 * invalidation really is — see `invalidateStorefront()` for why enumerating
 * which write affects which page is a list that rots.
 *
 * Entirely optional: with no `STOREFRONT_URL` configured this is a no-op, and
 * the storefront falls back to its own 60-second `revalidate` windows. A
 * failed call is logged and swallowed — the write it follows has already been
 * committed and acknowledged.
 */
export async function revalidateStorefront(companyId, req) {
  if (!env.storefront.url || !env.storefront.revalidateSecret) return;

  const hosts = await cached(companyId, 'hosts', TTL.host, async () => {
    const rows = await withPlatform((conn) => listDomainsByCompany(conn, companyId), {
      reqId: req?.id,
    });
    return rows.map((row) => row.HOST);
  });

  if (hosts.length === 0) return;

  try {
    const res = await fetch(new URL('/api/revalidate', env.storefront.url), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Revalidate-Secret': env.storefront.revalidateSecret,
      },
      body: JSON.stringify({ hosts }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) {
      logger.warn({ companyId, status: res.status }, 'storefront revalidation refused');
    }
  } catch (err) {
    logger.warn({ err, companyId }, 'storefront revalidation failed; its cache will expire on its own');
  }
}
