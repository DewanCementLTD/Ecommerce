import { Router } from 'express';
import * as controller from './shop.controller.js';

export const shopRouter = Router();

shopRouter.get('/products', controller.getProducts);
shopRouter.get('/products/:slug', controller.getProduct);
shopRouter.get('/cats', controller.getCats);
shopRouter.get('/cats/:slug', controller.getCat);
shopRouter.get('/colls/:slug', controller.getColl);
shopRouter.get('/search', controller.getSearch);
shopRouter.get('/langs', controller.getLangs);
shopRouter.get('/menus', controller.getMenus);
shopRouter.get('/home', controller.getHome);
shopRouter.get('/sitemap', controller.getSitemap);
shopRouter.get('/pages/:slug', controller.getPage);
