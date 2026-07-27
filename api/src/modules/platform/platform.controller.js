import {
  createCompanySchema,
  updateCompanySchema,
  listQuerySchema,
  addDomainSchema,
  logsQuerySchema,
} from './platform.schema.js';
import * as platformService from './platform.service.js';

export async function postCompany(req, res, next) {
  try {
    const body = createCompanySchema.parse(req.body);
    const result = await platformService.provisionCompany(body, { actorAdminId: req.admin.id, ip: req.ip });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getCompanies(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await platformService.listCompanies(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getCompany(req, res, next) {
  try {
    const company = await platformService.getCompany({ id: Number(req.params.id) });
    res.json({ company });
  } catch (err) {
    next(err);
  }
}

export async function patchCompany(req, res, next) {
  try {
    const body = updateCompanySchema.parse(req.body);
    const company = await platformService.updateCompany({
      id: Number(req.params.id),
      actorAdminId: req.admin.id,
      ip: req.ip,
      ...body,
    });
    res.json({ company });
  } catch (err) {
    next(err);
  }
}

export async function postSuspend(req, res, next) {
  try {
    await platformService.suspendCompany({ id: Number(req.params.id), actorAdminId: req.admin.id, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function postActivate(req, res, next) {
  try {
    await platformService.activateCompany({ id: Number(req.params.id), actorAdminId: req.admin.id, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function postDomain(req, res, next) {
  try {
    const body = addDomainSchema.parse(req.body);
    const domain = await platformService.addDomain({
      companyId: Number(req.params.id),
      host: body.host,
      actorAdminId: req.admin.id,
      ip: req.ip,
    });
    res.status(201).json({ domain });
  } catch (err) {
    next(err);
  }
}

export async function deleteDomain(req, res, next) {
  try {
    await platformService.removeDomain({
      domainId: Number(req.params.id),
      actorAdminId: req.admin.id,
      ip: req.ip,
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function getLogs(req, res, next) {
  try {
    const query = logsQuerySchema.parse(req.query);
    const result = await platformService.listLogs(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function postImpersonate(req, res, next) {
  try {
    const result = await platformService.impersonate({
      companyId: Number(req.params.id),
      actorAdminId: req.admin.id,
      ip: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
