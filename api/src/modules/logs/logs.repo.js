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
