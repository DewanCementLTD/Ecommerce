import { loginSchema, refreshSchema } from './auth.schema.js';
import * as authService from './auth.service.js';

export async function postLogin(req, res, next) {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login({ ...body, ip: req.ip });
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
