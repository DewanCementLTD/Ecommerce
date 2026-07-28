import { Router } from 'express';
import * as controller from './carts.controller.js';

export const cartRouter = Router();

cartRouter.get('/', controller.getCart);
cartRouter.post('/items', controller.postItem);
cartRouter.patch('/items/:id', controller.patchItem);
cartRouter.delete('/items/:id', controller.deleteItem);
cartRouter.delete('/', controller.deleteCart);
