import { Router } from 'express';
import { postCreate, getList, getTree, getOne, patchOne, postReorder, deleteOne } from './cats.controller.js';

export const catsRouter = Router();

// /tree and /reorder are declared before /:id so they are not swallowed by it.
catsRouter.get('/tree', getTree);
catsRouter.post('/reorder', postReorder);
catsRouter.get('/', getList);
catsRouter.post('/', postCreate);
catsRouter.get('/:id', getOne);
catsRouter.patch('/:id', patchOne);
catsRouter.delete('/:id', deleteOne);
