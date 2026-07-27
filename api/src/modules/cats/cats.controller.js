import {
  idParamSchema,
  createBodySchema,
  patchBodySchema,
  listQuerySchema,
  treeQuerySchema,
  reorderBodySchema,
} from './cats.schema.js';
import * as catsService from './cats.service.js';

export async function postCreate(req, res, next) {
  try {
    const body = createBodySchema.parse(req.body);
    const cat = await catsService.createCat({ companyId: req.admin.companyId, ...body });
    res.status(201).json({ cat });
  } catch (err) {
    next(err);
  }
}

export async function getList(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await catsService.listCats({ companyId: req.admin.companyId, ...query });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getTree(req, res, next) {
  try {
    const query = treeQuerySchema.parse(req.query);
    const result = await catsService.getCatTree({ companyId: req.admin.companyId, ...query });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const cat = await catsService.getCat({ companyId: req.admin.companyId, id });
    res.json({ cat });
  } catch (err) {
    next(err);
  }
}

export async function patchOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = patchBodySchema.parse(req.body);
    const cat = await catsService.patchCat({ companyId: req.admin.companyId, id, ...body });
    res.json({ cat });
  } catch (err) {
    next(err);
  }
}

export async function postReorder(req, res, next) {
  try {
    const body = reorderBodySchema.parse(req.body);
    const result = await catsService.reorderCats({ companyId: req.admin.companyId, items: body.items });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function deleteOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const result = await catsService.deleteCat({ companyId: req.admin.companyId, id });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
