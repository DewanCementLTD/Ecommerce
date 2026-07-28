import { getRedis } from './redis.js';
import { logger } from './logger.js';

/**
 * The Redis caching layer from `00-SYSTEM-DESIGN.md §7`.
 *
 * | What | TTL | Invalidated by |
 * |---|---|---|
 * | host → company | 5 min | domain edit |
 * | company settings | 5 min | settings save |
 * | menus | 10 min | menu save |
 * | rendered page sections | 10 min | page publish |
 *
 * **Every company-owned key is prefixed `co:{id}:`.** That prefix is not a
 * naming convention — it is the tenant boundary for the cache, the same way
 * `company_id` is for the database. A key without it is reachable by every
 * store, so a single missing prefix is a cross-tenant leak that no VPD policy
 * can catch. `companyKey()` is the only way to build one, it refuses anything
 * that is not a positive integer company id, and `cache.test.js` asserts that
 * every key this module can produce carries the prefix.
 *
 * The one deliberate exception is the host → company lookup, which runs
 * *before* any company is known and so cannot be company-scoped. It lives under
 * its own `sf:host:` namespace via `platformKey()`, which is spelled
 * differently on purpose: a reader should never mistake it for a
 * company-scoped key that forgot its prefix.
 */

export const COMPANY_PREFIX = 'co';
export const PLATFORM_PREFIX = 'sf';

export const TTL = {
  host: 5 * 60,
  settings: 5 * 60,
  company: 5 * 60,
  menus: 10 * 60,
  sections: 10 * 60,
};

/**
 * `co:{companyId}:{name}` — the only sanctioned way to name a company-scoped
 * cache entry.
 */
export function companyKey(companyId, ...parts) {
  if (!Number.isInteger(Number(companyId)) || Number(companyId) <= 0) {
    throw new Error(`companyKey requires a company id, got ${JSON.stringify(companyId)}`);
  }
  if (parts.length === 0 || parts.some((part) => part === undefined || part === null || part === '')) {
    throw new Error('companyKey requires at least one non-empty name part');
  }
  return `${COMPANY_PREFIX}:${Number(companyId)}:${parts.join(':')}`;
}

/** Platform-level keys: nothing company-owned may use this. */
export function platformKey(...parts) {
  return `${PLATFORM_PREFIX}:${parts.join(':')}`;
}

/**
 * The per-company index of live cache keys.
 *
 * Several cached values are per language (`menus:en`, `menus:ar`) or per page
 * (`sections:about`), so invalidation has to be able to say "every menu for
 * this company" without knowing which languages exist. Redis has two ways to
 * do that — `KEYS`/`SCAN` over the whole keyspace, or keeping a set of the
 * keys we wrote — and only the second is safe on a shared Redis: `KEYS`
 * blocks the server, and `SCAN` is O(keyspace) for something that happens on
 * every settings save.
 *
 * The index is itself a company-scoped key, so it obeys the same prefix rule
 * as everything else, and it carries the longest TTL of anything in it so a
 * dormant store's index cannot outlive its contents forever.
 */
const INDEX_NAME = 'idx';
const INDEX_TTL = Math.max(...Object.values(TTL)) * 2;

/**
 * Read-through cache around a company-scoped value.
 *
 * A Redis failure is logged and ignored: a cache that is down must degrade to
 * "slower", never to "broken". The same applies to a value that no longer
 * parses — a stale shape from an older deploy is treated as a miss.
 */
export async function cached(companyId, name, ttlSeconds, loader) {
  const key = companyKey(companyId, name);
  const indexKey = companyKey(companyId, INDEX_NAME);
  const redis = getRedis();

  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit);
  } catch (err) {
    logger.warn({ err, key }, 'cache read failed; falling through to the database');
  }

  const value = await loader();

  try {
    await redis
      .multi()
      .set(key, JSON.stringify(value), 'EX', ttlSeconds)
      .sadd(indexKey, name)
      .expire(indexKey, INDEX_TTL)
      .exec();
  } catch (err) {
    logger.warn({ err, key }, 'cache write failed; the value is still correct');
  }

  return value;
}

/**
 * Drops every cached entry for one company whose name starts with one of the
 * given prefixes — `invalidate(id, 'menus')` clears `menus:en` and `menus:ar`
 * alike.
 *
 * Called from the service layer at the moment of the write, in the same
 * function that commits it: a cache invalidated by a background sweep is a
 * cache that serves stale data for however long the sweep takes.
 */
export async function invalidate(companyId, ...prefixes) {
  const indexKey = companyKey(companyId, INDEX_NAME);
  const redis = getRedis();

  try {
    const names = await redis.smembers(indexKey);
    const matched = names.filter((name) =>
      prefixes.some((prefix) => name === prefix || name.startsWith(`${prefix}:`)),
    );
    if (matched.length === 0) return;

    await redis
      .multi()
      .del(...matched.map((name) => companyKey(companyId, name)))
      .srem(indexKey, ...matched)
      .exec();
  } catch (err) {
    logger.warn({ err, companyId, prefixes }, 'cache invalidation failed; entries will expire on their TTL');
  }
}

/**
 * Everything the public storefront renders from cache, for one company.
 *
 * Deliberately coarse. Menus resolve category and collection slugs, and
 * rendered sections embed product cards with live prices and stock — so almost
 * any write in the admin can change what a cached storefront page should say.
 * Enumerating which writes affect which entries would be a list that silently
 * goes stale the first time someone adds an endpoint; dropping both entries
 * costs one uncached render of a page that just changed anyway.
 */
export async function invalidateStorefront(companyId) {
  await invalidate(companyId, 'menus', 'sections');
}

/** Drops the host → company entry for one host (domain edits, suspension). */
export async function invalidateHost(host) {
  if (!host) return;
  try {
    await getRedis().del(platformKey('host', String(host).toLowerCase()));
  } catch (err) {
    logger.warn({ err, host }, 'host cache invalidation failed');
  }
}
