import { Router } from 'express';
import * as controller from './shop.controller.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { companyKey } from '../../lib/cache.js';

/**
 * Search is the one public read that runs a LIKE across three columns and
 * cannot be served from cache (every term is a different query), so it is the
 * cheapest endpoint to point a script at. Generous enough that a real shopper
 * typing quickly never sees it.
 */
const searchRateLimit = rateLimit({
  keyFn: (req) => companyKey(req.companyId, 'search', req.ip),
  limit: 60,
  windowSeconds: 60,
});

export const shopRouter = Router();

shopRouter.get('/products', controller.getProducts);
shopRouter.get('/products/:slug', controller.getProduct);
shopRouter.get('/cats', controller.getCats);
shopRouter.get('/cats/:slug', controller.getCat);
shopRouter.get('/colls/:slug', controller.getColl);
shopRouter.get('/search', searchRateLimit, controller.getSearch);
shopRouter.get('/langs', controller.getLangs);
shopRouter.get('/menus', controller.getMenus);
shopRouter.get('/home', controller.getHome);
shopRouter.get('/sitemap', controller.getSitemap);
shopRouter.get('/pages/:slug', controller.getPage);
