import { idParamSchema, adminCreateSchema, adminPatchSchema, roleCreateSchema, rolePatchSchema } from './staff.schema.js';
import * as staffService from './staff.service.js';

const actor = (req) => ({ actorAdminId: req.admin.id, ip: req.ip });

export async function getAdmins(req, res, next) {
  try {
    res.json(await staffService.listAdmins({ companyId: req.admin.companyId }));
  } catch (err) {
    next(err);
  }
}

export async function postAdmin(req, res, next) {
  try {
    const body = adminCreateSchema.parse(req.body);
    res.status(201).json(await staffService.createAdmin({ companyId: req.admin.companyId, ...actor(req), ...body }));
  } catch (err) {
    next(err);
  }
}

export async function patchAdmin(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = adminPatchSchema.parse(req.body);
    res.json(await staffService.patchAdmin({ companyId: req.admin.companyId, id, ...actor(req), ...body }));
  } catch (err) {
    next(err);
  }
}

export async function deleteAdmin(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await staffService.deleteAdmin({ companyId: req.admin.companyId, id, ...actor(req) }));
  } catch (err) {
    next(err);
  }
}

export async function getRoles(req, res, next) {
  try {
    res.json(await staffService.listRoles({ companyId: req.admin.companyId }));
  } catch (err) {
    next(err);
  }
}

export async function postRole(req, res, next) {
  try {
    const body = roleCreateSchema.parse(req.body);
    res.status(201).json(await staffService.createRole({ companyId: req.admin.companyId, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function patchRole(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = rolePatchSchema.parse(req.body);
    res.json(await staffService.patchRole({ companyId: req.admin.companyId, id, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function deleteRole(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await staffService.deleteRole({ companyId: req.admin.companyId, id }));
  } catch (err) {
    next(err);
  }
}
