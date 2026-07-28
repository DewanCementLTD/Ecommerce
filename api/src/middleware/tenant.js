import { withPlatform } from '../db/pool.js';
import { getRedis } from '../lib/redis.js';
import { findCompanyIdByHost, findCompanyById } from '../modules/tenants/tenants.repo.js';
import { AppError } from './error.js';

const HOST_CACHE_TTL_SECONDS = 5 * 60;

function normalizeHost(rawHost) {
  const first = (rawHost ?? '').split(',')[0].trim().toLowerCase();
  const withoutPort = first.split(':')[0];
  return withoutPort.startsWith('www.') ? withoutPort.slice(4) : withoutPort;
}

export async function tenantResolver(req, res, next) {
  try {
    const host = normalizeHost(req.headers['x-forwarded-host'] || req.headers.host);
    const redis = getRedis();
    const cacheKey = `host:${host}`;

    let companyId = await redis.get(cacheKey);

    if (!companyId) {
      companyId = await withPlatform((conn) => findCompanyIdByHost(conn, host), { reqId: req.id });

      if (!companyId) {
        return next(new AppError(404, 'SITE_NOT_FOUND', 'This domain is not connected to any store.'));
      }

      await redis.set(cacheKey, String(companyId), 'EX', HOST_CACHE_TTL_SECONDS);
    }

    const company = await withPlatform((conn) => findCompanyById(conn, Number(companyId)), {
      reqId: req.id,
    });

    if (!company) {
      return next(new AppError(404, 'SITE_NOT_FOUND', 'This domain is not connected to any store.'));
    }

    if (company.STATUS === 'suspended') {
      return res.status(503).json({
        error: { code: 'COMPANY_SUSPENDED', message: 'This store is temporarily unavailable.' },
      });
    }

    req.companyId = company.ID;
    req.company = {
      id: company.ID,
      name: company.NAME,
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
