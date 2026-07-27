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
 */

export async function getProducts(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json(await shopService.listProducts({ companyId: req.companyId, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getProduct(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    const product = await shopService.getProduct({ companyId: req.companyId, slug });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function getCats(req, res, next) {
  try {
    res.json(await shopService.getCatTree({ companyId: req.companyId }));
  } catch (err) {
    next(err);
  }
}

export async function getCat(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    const query = catProductsQuerySchema.parse(req.query);
    res.json(await shopService.getCatWithProducts({ companyId: req.companyId, slug, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getColl(req, res, next) {
  try {
    const { slug } = slugParamSchema.parse(req.params);
    const query = collProductsQuerySchema.parse(req.query);
    res.json(await shopService.getCollWithProducts({ companyId: req.companyId, slug, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getSearch(req, res, next) {
  try {
    const query = searchQuerySchema.parse(req.query);
    res.json(await shopService.search({ companyId: req.companyId, ...query }));
  } catch (err) {
    next(err);
  }
}
