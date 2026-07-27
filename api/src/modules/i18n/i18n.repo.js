import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/* -------------------------------------------------------------------- langs */

export async function listLangs(conn, { companyId }) {
  const result = await conn.execute(
    `SELECT id, company_id, code, name, is_default, is_active FROM langs
      WHERE company_id = :companyId
      ORDER BY is_default DESC, code`,
    { companyId },
  );
  return result.rows;
}

export async function findLangById(conn, { companyId, id }) {
  const result = await conn.execute(
    'SELECT id, company_id, code, name, is_default, is_active FROM langs WHERE id = :id AND company_id = :companyId',
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findLangByCode(conn, { companyId, code }) {
  const result = await conn.execute(
    'SELECT id, company_id, code, name, is_default, is_active FROM langs WHERE code = :code AND company_id = :companyId',
    { code, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findDefaultLang(conn, { companyId }) {
  const result = await conn.execute(
    'SELECT id, company_id, code, name, is_default, is_active FROM langs WHERE company_id = :companyId AND is_default = 1',
    { companyId },
  );
  return result.rows[0] ?? null;
}

export async function insertLang(conn, { companyId, code, name, isDefault, isActive }) {
  const result = await conn.execute(
    `INSERT INTO langs (company_id, code, name, is_default, is_active)
     VALUES (:companyId, :code, :name, :isDefault, :isActive)
     RETURNING id INTO :id`,
    { companyId, code, name, isDefault, isActive, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function updateLang(conn, { companyId, id, name, isActive }) {
  const result = await conn.execute(
    'UPDATE langs SET name = :name, is_active = :isActive WHERE id = :id AND company_id = :companyId',
    { id, companyId, name, isActive },
  );
  return result.rowsAffected > 0;
}

export async function clearDefaultLang(conn, { companyId }) {
  await conn.execute('UPDATE langs SET is_default = 0 WHERE company_id = :companyId AND is_default = 1', {
    companyId,
  });
}

export async function markLangDefault(conn, { companyId, id }) {
  await conn.execute('UPDATE langs SET is_default = 1, is_active = 1 WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
}

export async function deleteLangById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM langs WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

export async function deleteTransByLang(conn, { companyId, lang }) {
  const result = await conn.execute('DELETE FROM trans WHERE company_id = :companyId AND lang = :lang', {
    companyId,
    lang,
  });
  return result.rowsAffected;
}

/* -------------------------------------------------------------------- trans */

/**
 * Every translation for a set of ids, in one statement.
 *
 * This is the query the whole i18n design rests on: a category page rendering
 * 24 products asks once, not 24 times. Callers pass every id they are about to
 * render; the service turns the flat rows into a lookup map.
 */
export async function listTransForEntities(conn, { companyId, entity, entityIds, langs }) {
  if (entityIds.length === 0 || langs.length === 0) return [];

  const binds = { companyId, entity };
  const idPlaceholders = entityIds.map((id, index) => {
    binds[`e${index}`] = id;
    return `:e${index}`;
  });
  const langPlaceholders = langs.map((lang, index) => {
    binds[`l${index}`] = lang;
    return `:l${index}`;
  });

  const result = await conn.execute(
    `SELECT entity_id, lang, field, value FROM trans
      WHERE company_id = :companyId
        AND entity = :entity
        AND entity_id IN (${idPlaceholders.join(', ')})
        AND lang IN (${langPlaceholders.join(', ')})`,
    binds,
  );
  return result.rows;
}

export async function listTransForEntity(conn, { companyId, entity, entityId }) {
  const result = await conn.execute(
    `SELECT lang, field, value FROM trans
      WHERE company_id = :companyId AND entity = :entity AND entity_id = :entityId
      ORDER BY lang, field`,
    { companyId, entity, entityId },
  );
  return result.rows;
}

/**
 * Upsert one field. MERGE rather than delete-then-insert so a save that only
 * touches one field cannot briefly leave the row missing for a concurrent read.
 */
export async function upsertTrans(conn, { companyId, entity, entityId, lang, field, value }) {
  await conn.execute(
    `MERGE INTO trans t
     USING (SELECT :companyId AS company_id, :entity AS entity, :entityId AS entity_id,
                   :lang AS lang, :field AS field FROM dual) src
        ON (t.company_id = src.company_id AND t.entity = src.entity
            AND t.entity_id = src.entity_id AND t.lang = src.lang AND t.field = src.field)
      WHEN MATCHED THEN
        UPDATE SET t.value = :value1, t.updated_at = SYSTIMESTAMP
      WHEN NOT MATCHED THEN
        INSERT (company_id, entity, entity_id, lang, field, value)
        VALUES (src.company_id, src.entity, src.entity_id, src.lang, src.field, :value2)`,
    { companyId, entity, entityId, lang, field, value1: value, value2: value },
  );
}

export async function deleteTransField(conn, { companyId, entity, entityId, lang, field }) {
  const result = await conn.execute(
    `DELETE FROM trans
      WHERE company_id = :companyId AND entity = :entity AND entity_id = :entityId
        AND lang = :lang AND field = :field`,
    { companyId, entity, entityId, lang, field },
  );
  return result.rowsAffected;
}
