import { Router } from 'express';
import * as controller from './products.controller.js';

export const productsRouter = Router();

// /bulk before /:id so it is not read as a product id.
productsRouter.post('/bulk', controller.postBulk);

productsRouter.get('/', controller.getList);
productsRouter.post('/', controller.postCreate);
productsRouter.get('/:id', controller.getOne);
productsRouter.patch('/:id', controller.patchOne);
productsRouter.delete('/:id', controller.deleteOne);

productsRouter.put('/:id/cats', controller.putCats);
productsRouter.put('/:id/options', controller.putOptions);

productsRouter.get('/:id/variants', controller.getVariants);
productsRouter.post('/:id/variants', controller.postVariant);
productsRouter.patch('/:id/variants/:variantId', controller.patchVariant);
productsRouter.delete('/:id/variants/:variantId', controller.deleteVariant);
productsRouter.post('/:id/variants/:variantId/stock', controller.postStock);

productsRouter.get('/:id/images', controller.getImages);
productsRouter.post('/:id/images', controller.postImage);
productsRouter.post('/:id/images/reorder', controller.postImageReorder);
productsRouter.patch('/:id/images/:imageId', controller.patchImage);
productsRouter.delete('/:id/images/:imageId', controller.deleteImage);
