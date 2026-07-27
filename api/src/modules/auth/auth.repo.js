export async function findAdminByEmail(conn, email) {
  const result = await conn.execute(
    `SELECT id, company_id, email, pass_hash, name, role, is_active
     FROM admins WHERE email = :email`,
    { email },
  );
  return result.rows[0] ?? null;
}

export async function findAdminById(conn, id) {
  const result = await conn.execute(
    `SELECT id, company_id, email, name, role, is_active
     FROM admins WHERE id = :id`,
    { id },
  );
  return result.rows[0] ?? null;
}

export async function touchLastLogin(conn, id) {
  await conn.execute('UPDATE admins SET last_login_at = SYSTIMESTAMP WHERE id = :id', { id });
}
