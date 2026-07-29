import { withPlatform } from '../db/pool.js';
import { getRedis } from '../lib/redis.js';
import { cached, platformKey, TTL } from '../lib/cache.js';
import { findCompanyIdByHost, findCompanyById } from '../modules/tenants/tenants.repo.js';
import { AppError } from './error.js';

/** Exported so /auth/login can scope a login to the store it was made on. */
export function normalizeHost(rawHost) {
  const first = (rawHost ?? '').split(',')[0].trim().toLowerCase();
  const withoutPort = first.split(':')[0];
  return withoutPort.startsWith('www.') ? withoutPort.slice(4) : withoutPort;
}

/**
 * Host → company, then company → its whole public shape, both from Redis.
 *
 * Two lookups per request against the platform pool was the single hottest
 * path in the system: every storefront page, every image, every cart call paid
 * for both. The host mapping was already cached (`00-SYSTEM-DESIGN.md §7`);
 * Phase 3 adds the company row itself, which is what actually costs a query
 * with three joins.
 *
 * The host key is deliberately *not* `co:{id}:`-prefixed — it is resolved
 * before any company is known, so there is no id to prefix it with. It lives
 * under `sf:host:` instead (see lib/cache.js), which no company-scoped reader
 * will ever mistake for a key that lost its prefix.
 */
export async function tenantResolver(req, res, next) {
  try {
    const host = normalizeHost(req.headers['x-forwarded-host'] || req.headers.host);
    const redis = getRedis();
    const hostKey = platformKey('host', host);

    let companyId = await redis.get(hostKey);

    if (!companyId) {
      companyId = await withPlatform((conn) => findCompanyIdByHost(conn, host), { reqId: req.id });

      if (!companyId) {
        return next(new AppError(404, 'SITE_NOT_FOUND', 'This domain is not connected to any store.'));
      }

      await redis.set(hostKey, String(companyId), 'EX', TTL.host);
    }

    const company = await cached(Number(companyId), 'company', TTL.company, () =>
      withPlatform((conn) => findCompanyById(conn, Number(companyId)), { reqId: req.id }),
    );

    if (!company) {
      return next(new AppError(404, 'SITE_NOT_FOUND', 'This domain is not connected to any store.'));
    }

    if (company.STATUS === 'suspended') {
      return res.status(503).json({
        error: { code: 'COMPANY_SUSPENDED', message: 'This store is temporarily unavailable.' },
      });
    }

    req.companyId = company.ID;
    // Not `req.host` — Express defines that as a getter on IncomingMessage and
    // assigning to it throws.
    req.resolvedHost = host;
    req.company = {
      id: company.ID,
      name: company.NAME,
      /**
       * The domain this store's canonical URLs must point at. A company can
       * have several hosts (an old domain, a staging one, the `*.localhost`
       * used in development); exactly one is flagged primary, and every other
       * one is a duplicate as far as a crawler is concerned. Null when nothing
       * is flagged — the storefront then treats whatever host was asked for as
       * canonical, which is the only safe fallback.
       */
      primaryHost: company.PRIMARY_HOST ?? null,
      isPrimaryHost: !company.PRIMARY_HOST || company.PRIMARY_HOST === host,
      status: company.STATUS,
      themeId: company.THEME_ID,
      currency: company.CURRENCY,
      email: company.EMAIL,
      phone: company.PHONE,
      defaultLang: company.DEFAULT_LANG,
      theme: company.THEME_TOKENS ? JSON.parse(company.THEME_TOKENS) : null,
      logoMediaId: company.LOGO_MEDIA_ID,
    };

    next();
  } catch (err) {
    next(err);
  }
}
