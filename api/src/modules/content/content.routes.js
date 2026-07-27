import { Router } from 'express';
import * as controller from './content.controller.js';

/**
 * Three routers rather than one, because sections and menu items are addressed
 * both under their parent (list, create, reorder) and on their own (patch,
 * delete). Mounted separately in app.js.
 */

export const pagesRouter = Router();
pagesRouter.get('/', controller.getPages);
pagesRouter.post('/', controller.postPage);
pagesRouter.get('/:id', controller.getPage);
pagesRouter.patch('/:id', controller.patchPage);
pagesRouter.delete('/:id', controller.deletePage);
pagesRouter.get('/:id/sections', controller.getSections);
pagesRouter.post('/:id/sections', controller.postSection);
pagesRouter.post('/:id/sections/reorder', controller.postSectionReorder);

export const sectionsRouter = Router();
sectionsRouter.get('/registry', controller.getSectionRegistry);
sectionsRouter.patch('/:id', controller.patchSection);
sectionsRouter.delete('/:id', controller.deleteSection);

export const bannersRouter = Router();
bannersRouter.get('/', controller.getBanners);
bannersRouter.post('/', controller.postBanner);
bannersRouter.get('/:id', controller.getBanner);
bannersRouter.patch('/:id', controller.patchBanner);
bannersRouter.delete('/:id', controller.deleteBanner);

export const menusRouter = Router();
menusRouter.get('/', controller.getMenus);
menusRouter.patch('/:id', controller.patchMenu);
menusRouter.get('/:id/items', controller.getMenuItems);
menusRouter.post('/:id/items', controller.postMenuItem);
menusRouter.post('/:id/items/reorder', controller.postMenuItemReorder);

export const menuItemsRouter = Router();
menuItemsRouter.patch('/:id', controller.patchMenuItem);
menuItemsRouter.delete('/:id', controller.deleteMenuItem);
