import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

export async function findCartByToken(conn, { companyId, token }) {
  const result = await conn.execute(
    `SELECT id, token, customer_id, currency, created_at, updated_at, expires_at
       FROM carts WHERE company_id = :companyId AND token = :token`,
    { companyId, token },
  );
  return result.rows[0] ?? null;
}

export async function insertCart(conn, { companyId, token, customerId, currency, expiresAt }) {
  const result = await conn.execute(
    `INSERT INTO carts (company_id, token, customer_id, currency, expires_at)
     VALUES (:companyId, :token, :customerId, :currency, :expiresAt)
     RETURNING id INTO :id`,
    { companyId, token, customerId: customerId ?? null, currency: currency ?? null, expiresAt, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function touchCart(conn, { companyId, id, expiresAt }) {
  await conn.execute(
    'UPDATE carts SET updated_at = SYSTIMESTAMP, expires_at = :expiresAt WHERE company_id = :companyId AND id = :id',
    { companyId, id, expiresAt },
  );
}

export async function attachCustomer(conn, { companyId, id, customerId }) {
  await conn.execute('UPDATE carts SET customer_id = :customerId WHERE company_id = :companyId AND id = :id', {
    companyId,
    id,
    customerId,
  });
}

export async function deleteCart(conn, { companyId, id }) {
  await conn.execute('DELETE FROM carts WHERE company_id = :companyId AND id = :id', { companyId, id });
}

/* -------------------------------------------------------------------- items */

export async function listCartItems(conn, { companyId, cartId }) {
  const result = await conn.execute(
    `SELECT id, variant_id, qty, price_snap, created_at
       FROM cart_items WHERE company_id = :companyId AND cart_id = :cartId
      ORDER BY id ASC`,
    { companyId, cartId },
  );
  return result.rows;
}

export async function findCartItemByVariant(conn, { companyId, cartId, variantId }) {
  const result = await conn.execute(
    'SELECT id, qty FROM cart_items WHERE company_id = :companyId AND cart_id = :cartId AND variant_id = :variantId',
    { companyId, cartId, variantId },
  );
  return result.rows[0] ?? null;
}

export async function findCartItemById(conn, { companyId, cartId, id }) {
  const result = await conn.execute(
    'SELECT id, variant_id, qty, price_snap FROM cart_items WHERE company_id = :companyId AND cart_id = :cartId AND id = :id',
    { companyId, cartId, id },
  );
  return result.rows[0] ?? null;
}

export async function insertCartItem(conn, { companyId, cartId, variantId, qty, priceSnap }) {
  const result = await conn.execute(
    `INSERT INTO cart_items (company_id, cart_id, variant_id, qty, price_snap)
     VALUES (:companyId, :cartId, :variantId, :qty, :priceSnap)
     RETURNING id INTO :id`,
    { companyId, cartId, variantId, qty, priceSnap, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function updateCartItemQty(conn, { companyId, cartId, id, qty, priceSnap }) {
  await conn.execute(
    `UPDATE cart_items SET qty = :qty, price_snap = NVL(:priceSnap, price_snap)
      WHERE company_id = :companyId AND cart_id = :cartId AND id = :id`,
    { companyId, cartId, id, qty, priceSnap: priceSnap ?? null },
  );
}

export async function deleteCartItem(conn, { companyId, cartId, id }) {
  const result = await conn.execute(
    'DELETE FROM cart_items WHERE company_id = :companyId AND cart_id = :cartId AND id = :id',
    { companyId, cartId, id },
  );
  return result.rowsAffected > 0;
}

export async function deleteCartItems(conn, { companyId, cartId }) {
  await conn.execute('DELETE FROM cart_items WHERE company_id = :companyId AND cart_id = :cartId', {
    companyId,
    cartId,
  });
}
