import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import * as repo from './i18n.repo.js';

/** Which fields are translatable per entity. Anything else is rejected on write. */
export const TRANSLATABLE_FIELDS = {
  product: ['name', 'descr', 'shortDesc', 'metaTitle', 'metaDesc'],
  cat: ['name', 'descr', 'metaTitle', 'metaDesc'],
  coll: ['name', 'descr'],
  page: ['title', 'content', 'metaTitle', 'metaDesc'],
  section: ['title', 'heading', 'subheading', 'buttonLabel', 'html'],
  menu_item: ['label'],
  banner: ['alt'],
};

export const TRANSLATABLE_ENTITIES = Object.keys(TRANSLATABLE_FIELDS);

/* -------------------------------------------------------------------- langs */

export async function listLangs({ companyId }) {
  const rows = await withCompany(companyId, (conn) => repo.listLangs(conn, { companyId }));
  return { rows: camelRows(rows) };
}

export async function createLang({ companyId, code, name, isDefault, isActive }) {
  const langId = await withCompany(companyId, async (conn) => {
    const existing = await repo.findLangByCode(conn, { companyId, code });
    if (existing) {
      throw new AppError(409, 'LANG_EXISTS', `${code} is already one of this store's languages.`);
    }

    // Clear before set: a store has exactly one default language.
    if (isDefault) await repo.clearDefaultLang(conn, { companyId });

    const id = await repo.insertLang(conn, {
      companyId,
      code,
      name,
      isDefault: isDefault ? 1 : 0,
      isActive: isActive ?? 1,
    });
    await conn.commit();
    return id;
  });

  return getLang({ companyId, id: langId });
}

export async function getLang({ companyId, id }) {
  const row = await withCompany(companyId, (conn) => repo.findLangById(conn, { companyId, id }));
  if (!row) {
    throw new AppError(404, 'LANG_NOT_FOUND', 'Language not found.');
  }
  return camelRow(row);
}

export async function patchLang({ companyId, id, name, isActive, isDefault }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findLangById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'LANG_NOT_FOUND', 'Language not found.');
    }

    // The default language is the fallback for every missing translation, so it
    // cannot be switched off — only replaced by making another one default.
    const nextActive = isDefault || existing.IS_DEFAULT === 1 ? 1 : (isActive ?? existing.IS_ACTIVE);
    if (isActive === 0 && existing.IS_DEFAULT === 1 && !isDefault) {
      throw new AppError(
        409,
        'DEFAULT_LANG_ACTIVE',
        'The default language cannot be switched off. Make another language the default first.',
      );
    }

    await repo.updateLang(conn, {
      companyId,
      id,
      name: name ?? existing.NAME,
      isActive: nextActive,
    });

    if (isDefault && existing.IS_DEFAULT !== 1) {
      await repo.clearDefaultLang(conn, { companyId });
      await repo.markLangDefault(conn, { companyId, id });
    }

    await conn.commit();
  });

  return getLang({ companyId, id });
}

export async function deleteLang({ companyId, id }) {
  return withCompany(companyId, async (conn) => {
    const existing = await repo.findLangById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'LANG_NOT_FOUND', 'Language not found.');
    }
    if (existing.IS_DEFAULT === 1) {
      throw new AppError(
        409,
        'DEFAULT_LANG_PROTECTED',
        'The default language cannot be deleted. Make another language the default first.',
      );
    }

    // Its translations go with it — orphan rows would silently reappear if the
    // language were ever added back.
    const removedTranslations = await repo.deleteTransByLang(conn, { companyId, lang: existing.CODE });
    await repo.deleteLangById(conn, { companyId, id });
    await conn.commit();

    return { removedTranslations };
  });
}

/* ------------------------------------------------------------- translations */

function assertEntity(entity) {
  if (!TRANSLATABLE_FIELDS[entity]) {
    throw new AppError(400, 'UNKNOWN_ENTITY', `"${entity}" cannot be translated.`);
  }
}

function assertFields(entity, fields) {
  const allowed = new Set(TRANSLATABLE_FIELDS[entity]);
  for (const field of Object.keys(fields)) {
    if (!allowed.has(field)) {
      throw new AppError(400, 'UNKNOWN_FIELD', `"${field}" is not a translatable field on ${entity}.`);
    }
  }
}

/**
 * Translations for a batch of rows, with per-field fallback to the default
 * language.
 *
 * Per-field, not per-row: a product translated into Arabic with only its name
 * filled in shows the Arabic name and the default-language description, rather
 * than falling back wholesale to the default for everything. That is what makes
 * a half-finished translation useful instead of invisible.
 *
 * One query for the whole batch — never one per row.
 *
 * @returns {Promise<Map<number, Record<string, string>>>} entityId -> { field: value }
 */
export async function loadTranslations({ companyId, entity, entityIds, lang, defaultLang, conn }) {
  assertEntity(entity);
  const ids = [...new Set(entityIds)].filter(Boolean);
  if (ids.length === 0 || !lang || lang === defaultLang) return new Map();

  const run = async (connection) =>
    repo.listTransForEntities(connection, { companyId, entity, entityIds: ids, langs: [lang] });

  const rows = conn ? await run(conn) : await withCompany(companyId, run);

  const byId = new Map();
  for (const row of rows) {
    if (row.VALUE === null || row.VALUE === '') continue;
    if (!byId.has(row.ENTITY_ID)) byId.set(row.ENTITY_ID, {});
    byId.get(row.ENTITY_ID)[row.FIELD] = row.VALUE;
  }
  return byId;
}

/**
 * Applies a translation map to already-loaded rows. Fields with no translation
 * keep their default-language value untouched.
 */
export function applyTranslations(rows, translationsById, { idKey = 'id' } = {}) {
  if (translationsById.size === 0) return rows;
  return rows.map((row) => {
    const overrides = translationsById.get(row[idKey]);
    return overrides ? { ...row, ...overrides } : row;
  });
}

/** Everything stored for one row, grouped by language — for the admin editor. */
export async function getEntityTranslations({ companyId, entity, entityId }) {
  assertEntity(entity);
  const rows = await withCompany(companyId, (conn) =>
    repo.listTransForEntity(conn, { companyId, entity, entityId }),
  );

  const byLang = {};
  for (const row of rows) {
    byLang[row.LANG] ??= {};
    byLang[row.LANG][row.FIELD] = row.VALUE;
  }
  return { entity, entityId, translations: byLang, fields: TRANSLATABLE_FIELDS[entity] };
}

/**
 * Writes one language's fields for one row. An empty string or null deletes the
 * translation rather than storing a blank, so the field falls back again
 * instead of rendering as empty.
 */
export async function putEntityTranslations({ companyId, entity, entityId, lang, fields }) {
  assertEntity(entity);
  assertFields(entity, fields);

  await withCompany(companyId, async (conn) => {
    const language = await repo.findLangByCode(conn, { companyId, code: lang });
    if (!language) {
      throw new AppError(400, 'LANG_NOT_ENABLED', `${lang} is not one of this store's languages.`);
    }

    for (const [field, value] of Object.entries(fields)) {
      if (value === null || value === '') {
        await repo.deleteTransField(conn, { companyId, entity, entityId, lang, field });
      } else {
        await repo.upsertTrans(conn, { companyId, entity, entityId, lang, field, value });
      }
    }
    await conn.commit();
  });

  return getEntityTranslations({ companyId, entity, entityId });
}
