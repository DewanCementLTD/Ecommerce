import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };
const OUT_NUM = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/** Row-lock serializes concurrent checkouts for this company onto one counter. */
export async function nextOrderNo(conn, { companyId }) {
  const result = await conn.execute(
    `UPDATE order_seq SET next_no = next_no + 1 WHERE company_id = :companyId
     RETURNING next_no INTO :nextNo`,
    { companyId, nextNo: OUT_NUM },
  );
  return result.outBinds.nextNo[0];
}

export async function insertOrder(conn, order) {
  const result = await conn.execute(
    `INSERT INTO orders (company_id, order_no, customer_id, status, name, email, phone, address,
                          note, subtotal, discount, total, currency, lang)
     VALUES (:companyId, :orderNo, :customerId, :status, :name, :email, :phone, :address,
             :note, :subtotal, :discount, :total, :currency, :lang)
     RETURNING id INTO :id`,
    { ...order, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function insertOrderItem(conn, item) {
  await conn.execute(
    `INSERT INTO order_items (company_id, order_id, variant_id, sku, name_snap, opts_snap, price_snap, qty, line_total)
     VALUES (:companyId, :orderId, :variantId, :sku, :nameSnap, :optsSnap, :priceSnap, :qty, :lineTotal)`,
    item,
  );
}

export async function insertOrderLog(conn, { companyId, orderId, fromStatus, toStatus, adminId, note }) {
  await conn.execute(
    `INSERT INTO order_log (company_id, order_id, from_status, to_status, admin_id, note)
     VALUES (:companyId, :orderId, :fromStatus, :toStatus, :adminId, :note)`,
    { companyId, orderId, fromStatus: fromStatus ?? null, toStatus, adminId: adminId ?? null, note: note ?? null },
  );
}

export async function findOrderById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT id, order_no, customer_id, status, name, email, phone, address, note,
            subtotal, discount, total, currency, lang, placed_at, updated_at
       FROM orders WHERE company_id = :companyId AND id = :id`,
    { companyId, id },
  );
  return result.rows[0] ?? null;
}

export async function listOrderItems(conn, { companyId, orderId }) {
  const result = await conn.execute(
    `SELECT id, variant_id, sku, name_snap, opts_snap, price_snap, qty, line_total
       FROM order_items WHERE company_id = :companyId AND order_id = :orderId ORDER BY id`,
    { companyId, orderId },
  );
  return result.rows;
}

export async function listOrderLog(conn, { companyId, orderId }) {
  const result = await conn.execute(
    `SELECT id, from_status, to_status, admin_id, note, created_at
       FROM order_log WHERE company_id = :companyId AND order_id = :orderId ORDER BY id`,
    { companyId, orderId },
  );
  return result.rows;
}

function buildListFilter({ companyId, status, search, customerId, dateFrom, dateTo }) {
  const filters = ['company_id = :companyId'];
  const binds = { companyId };
  if (status) {
    filters.push('status = :status');
    binds.status = status;
  }
  if (customerId) {
    filters.push('customer_id = :customerId');
    binds.customerId = customerId;
  }
  if (search) {
    filters.push('(LOWER(name) LIKE :search OR phone LIKE :searchRaw OR TO_CHAR(order_no) LIKE :searchRaw)');
    binds.search = `%${search.toLowerCase()}%`;
    binds.searchRaw = `%${search}%`;
  }
  if (dateFrom) {
    filters.push('placed_at >= :dateFrom');
    binds.dateFrom = new Date(dateFrom);
  }
  if (dateTo) {
    filters.push('placed_at <= :dateTo');
    binds.dateTo = new Date(dateTo);
  }
  return { where: `WHERE ${filters.join(' AND ')}`, binds };
}

export async function listOrders(conn, { companyId, page, pageSize, status, search, customerId, dateFrom, dateTo }) {
  const offset = (page - 1) * pageSize;
  const { where, binds } = buildListFilter({ companyId, status, search, customerId, dateFrom, dateTo });

  const rows = await conn.execute(
    `SELECT id, order_no, customer_id, status, name, phone, total, currency, placed_at
       FROM orders ${where}
      ORDER BY placed_at DESC
      OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...binds, offset, pageSize },
  );
  const count = await conn.execute(`SELECT COUNT(*) AS cnt FROM orders ${where}`, binds);
  return { rows: rows.rows, total: count.rows[0].CNT };
}

export async function listOrdersForExport(conn, { companyId, status, search, dateFrom, dateTo }) {
  const { where, binds } = buildListFilter({ companyId, status, search, dateFrom, dateTo });
  const result = await conn.execute(
    `SELECT order_no, status, name, phone, email, total, currency, placed_at
       FROM orders ${where}
      ORDER BY placed_at DESC`,
    binds,
  );
  return result.rows;
}

export async function updateOrderStatus(conn, { companyId, id, status }) {
  await conn.execute('UPDATE orders SET status = :status, updated_at = SYSTIMESTAMP WHERE company_id = :companyId AND id = :id', {
    companyId,
    id,
    status,
  });
}

export async function updateOrderContact(conn, { companyId, id, note, name, phone, email }) {
  await conn.execute(
    `UPDATE orders
        SET note = NVL(:note, note),
            name = NVL(:name, name),
            phone = NVL(:phone, phone),
            email = NVL(:email, email),
            updated_at = SYSTIMESTAMP
      WHERE company_id = :companyId AND id = :id`,
    { companyId, id, note: note ?? null, name: name ?? null, phone: phone ?? null, email: email ?? null },
  );
}

/* -------------------------------------------------------------- dashboard */

/** Bind is `:fromDate`, not `:from` — FROM is reserved even as a bind variable name (ORA-01745). */
export async function orderStatsForPeriod(conn, { companyId, from }) {
  const result = await conn.execute(
    `SELECT COUNT(*) AS order_count, NVL(SUM(total), 0) AS revenue
       FROM orders WHERE company_id = :companyId AND placed_at >= :fromDate AND status != 'cancelled'`,
    { companyId, fromDate: from },
  );
  return result.rows[0];
}

export async function countAwaitingConfirmation(conn, { companyId }) {
  const result = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM orders WHERE company_id = :companyId AND status = 'new'`,
    { companyId },
  );
  return result.rows[0].CNT;
}

export async function topProductsByQty(conn, { companyId, from, limit }) {
  const result = await conn.execute(
    `SELECT oi.name_snap, SUM(oi.qty) AS total_qty
       FROM order_items oi
       JOIN orders o ON o.company_id = oi.company_id AND o.id = oi.order_id
      WHERE oi.company_id = :companyId AND o.placed_at >= :fromDate AND o.status != 'cancelled'
      GROUP BY oi.name_snap
      ORDER BY total_qty DESC
      FETCH FIRST :limit ROWS ONLY`,
    { companyId, fromDate: from, limit },
  );
  return result.rows;
}

export async function revenueByDay(conn, { companyId, from }) {
  const result = await conn.execute(
    `SELECT TRUNC(placed_at) AS day, NVL(SUM(total), 0) AS revenue
       FROM orders
      WHERE company_id = :companyId AND placed_at >= :fromDate AND status != 'cancelled'
      GROUP BY TRUNC(placed_at)
      ORDER BY day`,
    { companyId, fromDate: from },
  );
  return result.rows;
}
