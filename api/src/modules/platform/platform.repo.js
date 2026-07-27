import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

export async function insertCompany(conn, { name, bizName, email, phone, currency, timezone, themeId }) {
  const result = await conn.execute(
    `INSERT INTO companies (name, biz_name, email, phone, currency, timezone, theme_id, status)
     VALUES (:name, :bizName, :email, :phone, :currency, :timezone, :themeId, 'active')
     RETURNING id INTO :id`,
    {
      name,
      bizName: bizName ?? null,
      email: email ?? null,
      phone: phone ?? null,
      currency: currency ?? null,
      timezone: timezone ?? null,
      themeId: themeId ?? null,
      id: OUT_ID,
    },
  );
  return result.outBinds.id[0];
}

export async function insertDomain(conn, { companyId, host, isPrimary }) {
  const result = await conn.execute(
    `INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, :isPrimary)
     RETURNING id INTO :id`,
    { companyId, host, isPrimary: isPrimary ? 1 : 0, id: OUT_ID },
  );
  return result.outBinds.id[0];
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

export async function insertSetting(conn, { companyId, key, value }) {
  await conn.execute('INSERT INTO settings (company_id, key, value) VALUES (:companyId, :key, :value)', {
    companyId,
    key,
    value,
  });
}

export async function insertLang(conn, { companyId, code, name, isDefault }) {
  await conn.execute(
    `INSERT INTO langs (company_id, code, name, is_default, is_active)
     VALUES (:companyId, :code, :name, :isDefault, 1)`,
    { companyId, code, name, isDefault: isDefault ? 1 : 0 },
  );
}

export async function findCompanyById(conn, id) {
  const result = await conn.execute(
    `SELECT id, name, biz_name, email, phone, logo_media_id, theme_id, currency, timezone, status, created_at, updated_at
     FROM companies WHERE id = :id`,
    { id },
  );
  return result.rows[0] ?? null;
}

export async function findDomainByHost(conn, host) {
  const result = await conn.execute('SELECT id FROM domains WHERE host = :host', { host });
  return result.rows[0] ?? null;
}

export async function findAdminByEmail(conn, email) {
  const result = await conn.execute('SELECT id FROM admins WHERE email = :email', { email });
  return result.rows[0] ?? null;
}

export async function listCompanies(conn, { page, pageSize, search, status }) {
  const offset = (page - 1) * pageSize;
  const searchPattern = search ? `%${search.toLowerCase()}%` : null;

  const filterSql = `(:search1 IS NULL OR LOWER(name) LIKE :search2 OR LOWER(biz_name) LIKE :search3 OR LOWER(email) LIKE :search4)
       AND (:status1 IS NULL OR status = :status2)`;
  const filterBinds = {
    search1: searchPattern,
    search2: searchPattern,
    search3: searchPattern,
    search4: searchPattern,
    status1: status ?? null,
    status2: status ?? null,
  };

  const rowsResult = await conn.execute(
    `SELECT id, name, biz_name, email, status, created_at FROM companies
     WHERE ${filterSql}
     ORDER BY created_at DESC
     OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...filterBinds, offset, pageSize },
  );

  const countResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM companies WHERE ${filterSql}`, filterBinds);

  return { rows: rowsResult.rows, total: countResult.rows[0].CNT };
}

export async function updateCompany(conn, { id, name, bizName, email, phone, currency, timezone, themeId }) {
  await conn.execute(
    `UPDATE companies SET
       name = :name, biz_name = :bizName, email = :email, phone = :phone,
       currency = :currency, timezone = :timezone, theme_id = :themeId, updated_at = SYSTIMESTAMP
     WHERE id = :id`,
    { id, name, bizName, email, phone, currency, timezone, themeId },
  );
  return findCompanyById(conn, id);
}

export async function setCompanyStatus(conn, { id, status }) {
  const result = await conn.execute('UPDATE companies SET status = :status, updated_at = SYSTIMESTAMP WHERE id = :id', {
    id,
    status,
  });
  return result.rowsAffected > 0;
}

export async function findDomainById(conn, id) {
  const result = await conn.execute('SELECT id, company_id, host FROM domains WHERE id = :id', { id });
  return result.rows[0] ?? null;
}

export async function deleteDomainById(conn, id) {
  const result = await conn.execute('DELETE FROM domains WHERE id = :id', { id });
  return result.rowsAffected > 0;
}
