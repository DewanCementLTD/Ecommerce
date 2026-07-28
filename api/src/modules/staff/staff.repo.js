import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/* --------------------------------------------------------------------- admins */

export async function listAdmins(conn, { companyId }) {
  const result = await conn.execute(
    `SELECT id, email, name, role, is_active, last_login_at, created_at
       FROM admins
      WHERE company_id = :companyId
      ORDER BY created_at ASC`,
    { companyId },
  );
  return result.rows;
}

export async function findAdminByEmail(conn, { companyId, email }) {
  const result = await conn.execute(
    'SELECT id FROM admins WHERE company_id = :companyId AND email = :email',
    { companyId, email },
  );
  return result.rows[0] ?? null;
}

export async function findAdminById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT id, email, name, role, is_active, last_login_at, created_at
       FROM admins WHERE company_id = :companyId AND id = :id`,
    { companyId, id },
  );
  return result.rows[0] ?? null;
}

export async function insertAdmin(conn, { companyId, email, passHash, name, role }) {
  const result = await conn.execute(
    `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
     VALUES (:companyId, :email, :passHash, :name, :role, 1)
     RETURNING id INTO :id`,
    { companyId, email, passHash, name, role, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function updateAdmin(conn, { companyId, id, name, role, isActive, passHash }) {
  await conn.execute(
    `UPDATE admins
        SET name = NVL(:name, name),
            role = NVL(:role, role),
            is_active = NVL(:isActive, is_active),
            pass_hash = NVL(:passHash, pass_hash)
      WHERE company_id = :companyId AND id = :id`,
    { companyId, id, name: name ?? null, role: role ?? null, isActive: isActive ?? null, passHash: passHash ?? null },
  );
}

export async function deleteAdmin(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM admins WHERE company_id = :companyId AND id = :id', {
    companyId,
    id,
  });
  return result.rowsAffected > 0;
}

export async function countActiveAdmins(conn, { companyId }) {
  const result = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM admins WHERE company_id = :companyId AND is_active = 1',
    { companyId },
  );
  return result.rows[0].CNT;
}

/* ---------------------------------------------------------------------- roles */

export async function listRoles(conn, { companyId }) {
  const result = await conn.execute(
    'SELECT id, code, name, perms FROM roles WHERE company_id = :companyId ORDER BY name ASC',
    { companyId },
  );
  return result.rows;
}

export async function findRoleById(conn, { companyId, id }) {
  const result = await conn.execute(
    'SELECT id, code, name, perms FROM roles WHERE company_id = :companyId AND id = :id',
    { companyId, id },
  );
  return result.rows[0] ?? null;
}

export async function insertRole(conn, { companyId, code, name, perms }) {
  const result = await conn.execute(
    `INSERT INTO roles (company_id, code, name, perms) VALUES (:companyId, :code, :name, :perms)
     RETURNING id INTO :id`,
    { companyId, code, name, perms, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function updateRole(conn, { companyId, id, name, perms }) {
  await conn.execute(
    `UPDATE roles SET name = NVL(:name, name), perms = NVL(:perms, perms)
      WHERE company_id = :companyId AND id = :id`,
    { companyId, id, name: name ?? null, perms: perms ?? null },
  );
}

export async function deleteRole(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM roles WHERE company_id = :companyId AND id = :id', {
    companyId,
    id,
  });
  return result.rowsAffected > 0;
}
