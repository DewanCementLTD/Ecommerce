import { invalidateStorefront } from '../lib/cache.js';
import { logger } from '../lib/logger.js';
import { revalidateStorefront } from '../lib/revalidate.js';

/**
 * One hook, every write.
 *
 * Any successful non-GET request that resolved to a company drops that
 * company's storefront cache entries and asks the Next.js storefront to
 * revalidate its own fetch cache for that store.
 *
 * This lives in middleware rather than in each service on purpose. The
 * alternative is an `invalidate()` call at the end of roughly twenty mutating
 * service functions across five modules, which is a list that goes stale the
 * first time someone adds an endpoint and forgets — and the failure mode of
 * forgetting is a store whose owner saves a price and does not see it change,
 * which is exactly the kind of bug that gets diagnosed as "the cache is
 * broken, turn it off". One hook cannot be forgotten.
 *
 * It runs on `finish`, after the response has been sent: invalidation must not
 * delay the client, and a request that failed must not invalidate anything.
 */
export function cacheBust(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  res.on('finish', () => {
    /*
     * Two different middlewares establish the company, and admin writes come
     * through the second one: `tenantResolver` sets `req.companyId` from the
     * host for public routes, while an authenticated admin's company lives on
     * `req.admin.companyId` (`requireCompany` only validates it — it does not
     * copy it). Reading just the first meant every admin save — the writes
     * this hook exists for — invalidated nothing at all.
     */
    const companyId = req.companyId ?? req.admin?.companyId;
    if (!companyId || res.statusCode >= 400) return;

    Promise.all([invalidateStorefront(companyId), revalidateStorefront(companyId, req)]).catch(
      (err) => {
        // Never surface this: the write itself succeeded and has already been
        // acknowledged. A failed invalidation costs staleness until the TTL,
        // not correctness.
        logger.warn({ err, companyId }, 'post-write cache invalidation failed');
      },
    );
  });

  next();
}
