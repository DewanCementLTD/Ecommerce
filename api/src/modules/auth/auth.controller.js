import { loginSchema, refreshSchema } from './auth.schema.js';
import * as authService from './auth.service.js';
import { normalizeHost } from '../../middleware/tenant.js';

export async function postLogin(req, res, next) {
  try {
    const body = loginSchema.parse(req.body);
    /*
     * The host the login was attempted on, so the service can refuse an
     * account that belongs to a different store. Read from the headers rather
     * than the body — the client does not get to choose which shop it is
     * signing in to.
     */
    const host = normalizeHost(req.headers['x-forwarded-host'] || req.headers.host);
    const result = await authService.login({ ...body, host, ip: req.ip });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function postRefresh(req, res, next) {
  try {
    const body = refreshSchema.parse(req.body);
    const result = await authService.refresh(body);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function postLogout(req, res, next) {
  try {
    await authService.logout({ admin: req.admin, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export function getMe(req, res) {
  res.json({ admin: req.admin });
}
