import {
  idParamSchema,
  createBodySchema,
  patchBodySchema,
  listQuerySchema,
  productsQuerySchema,
  membersBodySchema,
  reorderBodySchema,
} from './colls.schema.js';
import * as collsService from './colls.service.js';

export async function postCreate(req, res, next) {
  try {
    const body = createBodySchema.parse(req.body);
    const coll = await collsService.createColl({ companyId: req.admin.companyId, ...body });
    res.status(201).json({ coll });
  } catch (err) {
    next(err);
  }
}

export async function getList(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json(await collsService.listColls({ companyId: req.admin.companyId, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const coll = await collsService.getColl({ companyId: req.admin.companyId, id });
    res.json({ coll });
  } catch (err) {
    next(err);
  }
}

export async function patchOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = patchBodySchema.parse(req.body);
    const coll = await collsService.patchColl({ companyId: req.admin.companyId, id, ...body });
    res.json({ coll });
  } catch (err) {
    next(err);
  }
}

export async function deleteOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await collsService.deleteColl({ companyId: req.admin.companyId, id }));
  } catch (err) {
    next(err);
  }
}

export async function getProducts(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const query = productsQuerySchema.parse(req.query);
    res.json(await collsService.listCollProducts({ companyId: req.admin.companyId, id, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function putProducts(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { productIds } = membersBodySchema.parse(req.body);
    res.json(await collsService.setCollProducts({ companyId: req.admin.companyId, id, productIds }));
  } catch (err) {
    next(err);
  }
}

export async function postReorder(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { items } = reorderBodySchema.parse(req.body);
    res.json(await collsService.reorderCollProducts({ companyId: req.admin.companyId, id, items }));
  } catch (err) {
    next(err);
  }
}
