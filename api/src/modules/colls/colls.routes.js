import { Router } from 'express';
import * as controller from './colls.controller.js';

export const collsRouter = Router();

collsRouter.get('/', controller.getList);
collsRouter.post('/', controller.postCreate);
collsRouter.get('/:id', controller.getOne);
collsRouter.patch('/:id', controller.patchOne);
collsRouter.delete('/:id', controller.deleteOne);

collsRouter.get('/:id/products', controller.getProducts);
collsRouter.put('/:id/products', controller.putProducts);
collsRouter.post('/:id/products/reorder', controller.postReorder);
