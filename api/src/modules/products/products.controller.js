import {
  idParamSchema,
  variantParamSchema,
  imageParamSchema,
  createBodySchema,
  patchBodySchema,
  listQuerySchema,
  bulkBodySchema,
  catsBodySchema,
  imageBodySchema,
  imagePatchSchema,
  imageReorderSchema,
  optionsBodySchema,
  stockBodySchema,
  variantInputSchema,
} from './products.schema.js';
import * as productsService from './products.service.js';

/** Everything the service needs to attribute an audit log entry. */
const actor = (req) => ({ actorAdminId: req.admin.id, ip: req.ip });

export async function getList(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json(await productsService.listProducts({ companyId: req.admin.companyId, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function postCreate(req, res, next) {
  try {
    const body = createBodySchema.parse(req.body);
    const product = await productsService.createProduct({
      companyId: req.admin.companyId,
      ...actor(req),
      ...body,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const product = await productsService.getProduct({ companyId: req.admin.companyId, id });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function patchOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = patchBodySchema.parse(req.body);
    const product = await productsService.patchProduct({
      companyId: req.admin.companyId,
      id,
      ...actor(req),
      ...body,
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function deleteOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    await productsService.deleteProduct({ companyId: req.admin.companyId, id, ...actor(req) });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function postBulk(req, res, next) {
  try {
    const body = bulkBodySchema.parse(req.body);
    res.json(await productsService.bulkProducts({ companyId: req.admin.companyId, ...actor(req), ...body }));
  } catch (err) {
    next(err);
  }
}

export async function putCats(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { catIds } = catsBodySchema.parse(req.body);
    const product = await productsService.setProductCats({ companyId: req.admin.companyId, id, catIds });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function putOptions(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { options } = optionsBodySchema.parse(req.body);
    const product = await productsService.setOptions({
      companyId: req.admin.companyId,
      productId: id,
      options,
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function getVariants(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await productsService.listVariants({ companyId: req.admin.companyId, productId: id }));
  } catch (err) {
    next(err);
  }
}

export async function postVariant(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = variantInputSchema.parse(req.body);
    const product = await productsService.addVariant({
      companyId: req.admin.companyId,
      productId: id,
      ...body,
    });
    res.status(201).json({ product });
  } catch (err) {
    next(err);
  }
}

export async function patchVariant(req, res, next) {
  try {
    const { id, variantId } = variantParamSchema.parse(req.params);
    const body = variantInputSchema.partial().parse(req.body);
    const product = await productsService.patchVariant({
      companyId: req.admin.companyId,
      productId: id,
      variantId,
      ...body,
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function deleteVariant(req, res, next) {
  try {
    const { id, variantId } = variantParamSchema.parse(req.params);
    const product = await productsService.deleteVariant({
      companyId: req.admin.companyId,
      productId: id,
      variantId,
    });
    res.json({ product });
  } catch (err) {
    next(err);
  }
}

export async function postStock(req, res, next) {
  try {
    const { id, variantId } = variantParamSchema.parse(req.params);
    const body = stockBodySchema.parse(req.body);
    const result = await productsService.adjustStock({
      companyId: req.admin.companyId,
      productId: id,
      variantId,
      ...actor(req),
      ...body,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getImages(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await productsService.listImages({ companyId: req.admin.companyId, productId: id }));
  } catch (err) {
    next(err);
  }
}

export async function postImage(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = imageBodySchema.parse(req.body);
    const result = await productsService.addImage({
      companyId: req.admin.companyId,
      productId: id,
      ...body,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function patchImage(req, res, next) {
  try {
    const { id, imageId } = imageParamSchema.parse(req.params);
    const body = imagePatchSchema.parse(req.body);
    res.json(
      await productsService.patchImage({
        companyId: req.admin.companyId,
        productId: id,
        imageId,
        ...body,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteImage(req, res, next) {
  try {
    const { id, imageId } = imageParamSchema.parse(req.params);
    res.json(
      await productsService.deleteImage({ companyId: req.admin.companyId, productId: id, imageId }),
    );
  } catch (err) {
    next(err);
  }
}

export async function postImageReorder(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { items } = imageReorderSchema.parse(req.body);
    res.json(
      await productsService.reorderImages({ companyId: req.admin.companyId, productId: id, items }),
    );
  } catch (err) {
    next(err);
  }
}
