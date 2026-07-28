/**
 * `logs` has a VPD policy, and this always sets company_id explicitly rather
 * than relying on an implied context. Two valid callers:
 *
 * - `withPlatform()` for platform-level entries, where company_id may be NULL
 *   (a NULL would fail the policy's update_check on a company connection).
 * - `withCompany(companyId)` for company actions, passing that same companyId,
 *   so the audit entry commits in the same transaction as the change it records
 *   — a rolled-back product write leaves no log claiming it happened.
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

/**
 * The audit browser's filters (Phase 3, Task 4). Every one is optional and
 * expressed as `(:bind IS NULL OR column = :bind)` so a single statement
 * serves every combination — no string assembly, one plan in the cursor cache.
 *
 * `dateFrom`/`dateTo` are what make this usable during an incident: "what
 * happened between 14:00 and 15:00" is the first question asked, and paging
 * back through every action ever taken to find it is not an answer.
 */
export async function listLogs(conn, { page, pageSize, companyId, action, adminId, dateFrom, dateTo }) {
  const offset = (page - 1) * pageSize;
  const filterSql = `(:companyId1 IS NULL OR company_id = :companyId2)
       AND (:action1 IS NULL OR action = :action2)
       AND (:adminId1 IS NULL OR admin_id = :adminId2)
       AND (:dateFrom1 IS NULL OR created_at >= :dateFrom2)
       AND (:dateTo1 IS NULL OR created_at <= :dateTo2)`;
  const filterBinds = {
    companyId1: companyId ?? null,
    companyId2: companyId ?? null,
    action1: action ?? null,
    action2: action ?? null,
    adminId1: adminId ?? null,
    adminId2: adminId ?? null,
    dateFrom1: dateFrom ? new Date(dateFrom) : null,
    dateFrom2: dateFrom ? new Date(dateFrom) : null,
    dateTo1: dateTo ? new Date(dateTo) : null,
    dateTo2: dateTo ? new Date(dateTo) : null,
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
