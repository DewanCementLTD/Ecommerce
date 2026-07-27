import { idParamSchema, entityParamSchema, langCreateSchema, langPatchSchema, transPutSchema } from './i18n.schema.js';
import * as i18nService from './i18n.service.js';

const companyOf = (req) => req.admin.companyId;

export async function getLangs(req, res, next) {
  try {
    res.json(await i18nService.listLangs({ companyId: companyOf(req) }));
  } catch (err) {
    next(err);
  }
}

export async function postLang(req, res, next) {
  try {
    const body = langCreateSchema.parse(req.body);
    res.status(201).json({ lang: await i18nService.createLang({ companyId: companyOf(req), ...body }) });
  } catch (err) {
    next(err);
  }
}

export async function patchLang(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = langPatchSchema.parse(req.body);
    res.json({ lang: await i18nService.patchLang({ companyId: companyOf(req), id, ...body }) });
  } catch (err) {
    next(err);
  }
}

export async function deleteLang(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await i18nService.deleteLang({ companyId: companyOf(req), id }));
  } catch (err) {
    next(err);
  }
}

export async function getTranslations(req, res, next) {
  try {
    const { entity, id } = entityParamSchema.parse(req.params);
    res.json(await i18nService.getEntityTranslations({ companyId: companyOf(req), entity, entityId: id }));
  } catch (err) {
    next(err);
  }
}

export async function putTranslations(req, res, next) {
  try {
    const { entity, id } = entityParamSchema.parse(req.params);
    const body = transPutSchema.parse(req.body);
    res.json(
      await i18nService.putEntityTranslations({
        companyId: companyOf(req),
        entity,
        entityId: id,
        ...body,
      }),
    );
  } catch (err) {
    next(err);
  }
}
