/**
 * All callers go through withPlatform() — logs itself has a VPD policy, but
 * every write here needs to set an explicit company_id (including NULL for
 * platform-level actions), not one implied by an already-set context.
 */
export async function insertLog(conn, { companyId, adminId, action, entity, entityId, meta, ip }) {
  await conn.execute(
    `INSERT INTO logs (company_id, admin_id, action, entity, entity_id, meta, ip)
     VALUES (:companyId, :adminId, :action, :entity, :entityId, :meta, :ip)`,
    {
      companyId: companyId ?? null,
      adminId: adminId ?? null,
      action,
      entity: entity ?? null,
      entityId: entityId ?? null,
      meta: meta ? JSON.stringify(meta) : null,
      ip: ip ?? null,
    },
  );
}

export async function listLogs(conn, { page, pageSize, companyId, action }) {
  const offset = (page - 1) * pageSize;
  const filterSql = `(:companyId1 IS NULL OR company_id = :companyId2)
       AND (:action1 IS NULL OR action = :action2)`;
  const filterBinds = {
    companyId1: companyId ?? null,
    companyId2: companyId ?? null,
    action1: action ?? null,
    action2: action ?? null,
  };

  const rowsResult = await conn.execute(
    `SELECT id, company_id, admin_id, action, entity, entity_id, meta, ip, created_at
     FROM logs
     WHERE ${filterSql}
     ORDER BY created_at DESC
     OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...filterBinds, offset, pageSize },
  );

  const countResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM logs WHERE ${filterSql}`, filterBinds);

  return { rows: rowsResult.rows, total: countResult.rows[0].CNT };
}
