import {
  idParamSchema,
  registerSchema,
  loginSchema,
  refreshSchema,
  customerPatchSchema,
  addrCreateSchema,
  addrPatchSchema,
  listQuerySchema,
  adminPatchSchema,
} from './customers.schema.js';
import * as customersService from './customers.service.js';

/* --------------------------------------------------------------------- auth */

export async function postRegister(req, res, next) {
  try {
    const body = registerSchema.parse(req.body);
    res.status(201).json(await customersService.register({ companyId: req.companyId, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function postLogin(req, res, next) {
  try {
    const body = loginSchema.parse(req.body);
    res.json(await customersService.login({ companyId: req.companyId, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function postRefresh(req, res, next) {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    res.json(await customersService.refresh({ refreshToken }));
  } catch (err) {
    next(err);
  }
}

export async function postLogout(req, res, next) {
  try {
    await customersService.logout({ customer: req.customer });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function getMe(req, res, next) {
  try {
    res.json({ customer: await customersService.getMe({ companyId: req.companyId, id: req.customer.id }) });
  } catch (err) {
    next(err);
  }
}

export async function patchMe(req, res, next) {
  try {
    const body = customerPatchSchema.parse(req.body);
    res.json({
      customer: await customersService.patchMe({ companyId: req.companyId, id: req.customer.id, ...body }),
    });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------- addrs */

export async function getAddrs(req, res, next) {
  try {
    res.json(await customersService.listAddrs({ companyId: req.companyId, customerId: req.customer.id }));
  } catch (err) {
    next(err);
  }
}

export async function postAddr(req, res, next) {
  try {
    const body = addrCreateSchema.parse(req.body);
    res.status(201).json(
      await customersService.createAddr({ companyId: req.companyId, customerId: req.customer.id, ...body }),
    );
  } catch (err) {
    next(err);
  }
}

export async function patchAddr(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = addrPatchSchema.parse(req.body);
    res.json(
      await customersService.patchAddr({ companyId: req.companyId, customerId: req.customer.id, id, ...body }),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteAddr(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await customersService.deleteAddr({ companyId: req.companyId, customerId: req.customer.id, id }));
  } catch (err) {
    next(err);
  }
}

/* -------------------------------------------------------------------- admin */

export async function getList(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json(await customersService.listCustomers({ companyId: req.admin.companyId, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json({ customer: await customersService.getMe({ companyId: req.admin.companyId, id }) });
  } catch (err) {
    next(err);
  }
}

export async function patchOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = adminPatchSchema.parse(req.body);
    res.json({ customer: await customersService.adminPatchCustomer({ companyId: req.admin.companyId, id, ...body }) });
  } catch (err) {
    next(err);
  }
}
