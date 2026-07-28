import { putBodySchema } from './settings.schema.js';
import * as settingsService from './settings.service.js';

export async function getSettings(req, res, next) {
  try {
    res.json(await settingsService.getSettings({ companyId: req.admin.companyId }));
  } catch (err) {
    next(err);
  }
}

export async function putSettings(req, res, next) {
  try {
    const { values } = putBodySchema.parse(req.body);
    res.json(await settingsService.putSettings({ companyId: req.admin.companyId, values }));
  } catch (err) {
    next(err);
  }
}
