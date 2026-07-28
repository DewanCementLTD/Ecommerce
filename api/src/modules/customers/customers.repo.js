import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/* ----------------------------------------------------------------- customers */

export async function findCustomerByEmail(conn, { companyId, email }) {
  const result = await conn.execute(
    `SELECT id, company_id, email, phone, name, pass_hash, is_active, accepts_marketing, created_at
       FROM customers WHERE company_id = :companyId AND email = :email`,
    { companyId, email },
  );
  return result.rows[0] ?? null;
}

export async function findCustomerById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT id, company_id, email, phone, name, pass_hash, is_active, accepts_marketing, created_at
       FROM customers WHERE company_id = :companyId AND id = :id`,
    { companyId, id },
  );
  return result.rows[0] ?? null;
}

export async function insertCustomer(conn, { companyId, email, phone, name, passHash, acceptsMarketing }) {
  const result = await conn.execute(
    `INSERT INTO customers (company_id, email, phone, name, pass_hash, is_active, accepts_marketing)
     VALUES (:companyId, :email, :phone, :name, :passHash, 1, :acceptsMarketing)
     RETURNING id INTO :id`,
    { companyId, email: email ?? null, phone, name, passHash: passHash ?? null, acceptsMarketing: acceptsMarketing ?? 0, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function updateCustomer(conn, { companyId, id, name, phone, acceptsMarketing, passHash, isActive }) {
  await conn.execute(
    `UPDATE customers
        SET name = NVL(:name, name),
            phone = NVL(:phone, phone),
            accepts_marketing = NVL(:acceptsMarketing, accepts_marketing),
            pass_hash = NVL(:passHash, pass_hash),
            is_active = NVL(:isActive, is_active),
            updated_at = SYSTIMESTAMP
      WHERE company_id = :companyId AND id = :id`,
    {
      companyId,
      id,
      name: name ?? null,
      phone: phone ?? null,
      acceptsMarketing: acceptsMarketing ?? null,
      passHash: passHash ?? null,
      isActive: isActive ?? null,
    },
  );
}

export async function listCustomers(conn, { companyId, page, pageSize, search }) {
  const offset = (page - 1) * pageSize;
  const filters = ['company_id = :companyId'];
  const binds = { companyId };
  if (search) {
    filters.push('(LOWER(name) LIKE :search OR LOWER(email) LIKE :search OR phone LIKE :searchRaw)');
    binds.search = `%${search.toLowerCase()}%`;
    binds.searchRaw = `%${search}%`;
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const rows = await conn.execute(
    `SELECT id, email, phone, name, is_active, accepts_marketing, created_at
       FROM customers ${where}
      ORDER BY created_at DESC
      OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...binds, offset, pageSize },
  );
  const count = await conn.execute(`SELECT COUNT(*) AS cnt FROM customers ${where}`, binds);
  return { rows: rows.rows, total: count.rows[0].CNT };
}

/* ------------------------------------------------------------------- addrs */

export async function listAddrs(conn, { companyId, customerId }) {
  const result = await conn.execute(
    `SELECT id, label, name, phone, line1, line2, city, area, notes, is_default
       FROM addrs WHERE company_id = :companyId AND customer_id = :customerId
      ORDER BY is_default DESC, id ASC`,
    { companyId, customerId },
  );
  return result.rows;
}

export async function findAddrById(conn, { companyId, customerId, id }) {
  const result = await conn.execute(
    `SELECT id, label, name, phone, line1, line2, city, area, notes, is_default
       FROM addrs WHERE company_id = :companyId AND customer_id = :customerId AND id = :id`,
    { companyId, customerId, id },
  );
  return result.rows[0] ?? null;
}

export async function insertAddr(conn, { companyId, customerId, label, name, phone, line1, line2, city, area, notes, isDefault }) {
  const result = await conn.execute(
    `INSERT INTO addrs (company_id, customer_id, label, name, phone, line1, line2, city, area, notes, is_default)
     VALUES (:companyId, :customerId, :label, :name, :phone, :line1, :line2, :city, :area, :notes, :isDefault)
     RETURNING id INTO :id`,
    {
      companyId, customerId,
      label: label ?? null, name, phone, line1,
      line2: line2 ?? null, city, area: area ?? null, notes: notes ?? null,
      isDefault: isDefault ?? 0, id: OUT_ID,
    },
  );
  return result.outBinds.id[0];
}

export async function clearDefaultAddr(conn, { companyId, customerId }) {
  await conn.execute(
    'UPDATE addrs SET is_default = 0 WHERE company_id = :companyId AND customer_id = :customerId AND is_default = 1',
    { companyId, customerId },
  );
}

export async function updateAddr(conn, { companyId, customerId, id, label, name, phone, line1, line2, city, area, notes, isDefault }) {
  await conn.execute(
    `UPDATE addrs
        SET label = NVL(:label, label),
            name = NVL(:name, name),
            phone = NVL(:phone, phone),
            line1 = NVL(:line1, line1),
            line2 = NVL(:line2, line2),
            city = NVL(:city, city),
            area = NVL(:area, area),
            notes = NVL(:notes, notes),
            is_default = NVL(:isDefault, is_default),
            updated_at = SYSTIMESTAMP
      WHERE company_id = :companyId AND customer_id = :customerId AND id = :id`,
    {
      companyId, customerId, id,
      label: label ?? null, name: name ?? null, phone: phone ?? null,
      line1: line1 ?? null, line2: line2 ?? null, city: city ?? null,
      area: area ?? null, notes: notes ?? null, isDefault: isDefault ?? null,
    },
  );
}

export async function deleteAddr(conn, { companyId, customerId, id }) {
  const result = await conn.execute(
    'DELETE FROM addrs WHERE company_id = :companyId AND customer_id = :customerId AND id = :id',
    { companyId, customerId, id },
  );
  return result.rowsAffected > 0;
}
