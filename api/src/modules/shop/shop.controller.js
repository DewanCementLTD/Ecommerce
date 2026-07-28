import {
  slugParamSchema,
  listQuerySchema,
  catProductsQuerySchema,
  collProductsQuerySchema,
  searchQuerySchema,
} from './shop.schema.js';
import * as shopService from './shop.service.js';

/**
 * Public, unauthenticated, and tenant-scoped: the company always comes from
 * req.companyId, which tenantResolver derived from the host. No handler here
 * reads a company id from the query, body, or params.
 *
 * `?lang=` selects the response language. An unknown or absent value simply
 * means the store's default — a bad language code must never be an error page.
 */

function localeOf(req) {
  const requested = typeof req.query.lang === 'string' ? req.query.lang.trim().toLowerCase() : null;
  return { lang: requested || null, defaultLang: req.company?.defaultLang ?? null };
}

export async function getProducts(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json(await shopService.listProducts({ companyId: req.companyId, ...localeOf(req), ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    const product = await shopService.getProduct({ companyId: req.companyId, slug, ...localeOf(req) });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function getCats(req, res, next) {
  try {
    res.json(await shopService.getCatTree({ companyId: req.companyId, ...localeOf(req) }));
  } catch (err) {
    next(err);
  }
}

export async function getCat(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    const query = catProductsQuerySchema.parse(req.query);
    res.json(await shopService.getCatWithProducts({ companyId: req.companyId, slug, ...localeOf(req), ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getColl(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    const query = collProductsQuerySchema.parse(req.query);
    res.json(await shopService.getCollWithProducts({ companyId: req.companyId, slug, ...localeOf(req), ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getSearch(req, res, next) {
  try {
    const query = searchQuerySchema.parse(req.query);
    res.json(await shopService.search({ companyId: req.companyId, ...localeOf(req), ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getLangs(req, res, next) {
  try {
    res.json(await shopService.listLangs({ companyId: req.companyId }));
  } catch (err) {
    next(err);
  }
}

export async function getMenus(req, res, next) {
  try {
    res.json(await shopService.getMenus({ companyId: req.companyId, ...localeOf(req) }));
  } catch (err) {
    next(err);
  }
}

export async function getHome(req, res, next) {
  try {
    res.json(await shopService.getHome({ companyId: req.companyId, ...localeOf(req) }));
  } catch (err) {
    next(err);
  }
}

export async function getSitemap(req, res, next) {
  try {
    res.json(await shopService.getSitemap({ companyId: req.companyId }));
  } catch (err) {
    next(err);
  }
}

export async function getPage(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    res.json(await shopService.getPage({ companyId: req.companyId, slug, ...localeOf(req) }));
  } catch (err) {
    next(err);
  }
}
