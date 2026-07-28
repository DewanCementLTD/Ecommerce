export async function listSettings(conn, { companyId }) {
  const result = await conn.execute(
    'SELECT key, value FROM settings WHERE company_id = :companyId ORDER BY key ASC',
    { companyId },
  );
  return result.rows;
}

/** One row per key, upserted via MERGE so a partial save never races a concurrent read. */
export async function upsertSetting(conn, { companyId, key, value }) {
  await conn.execute(
    `MERGE INTO settings s
     USING (SELECT :companyId AS company_id, :key AS key FROM dual) src
        ON (s.company_id = src.company_id AND s.key = src.key)
     WHEN MATCHED THEN UPDATE SET value = :value1
     WHEN NOT MATCHED THEN INSERT (company_id, key, value) VALUES (src.company_id, src.key, :value2)`,
    { companyId, key, value1: value, value2: value },
  );
}
