import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-com-a-${suffix}@example.test`;
const emailB = `iso-com-b-${suffix}@example.test`;
const hostA = `iso-com-a-${suffix}.localhost`;
const hostB = `iso-com-b-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let tokenA;
let tokenB;

let customerAId;
let addrAId;
let orderAId;
let orderItemAId;

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);
const asB = (req) => req.set('Authorization', `Bearer ${tokenB}`);
const shopA = (method, path, cartToken) => {
  const req = request(app)[method](path).set('X-Forwarded-Host', hostA);
  return cartToken ? req.set('X-Cart-Token', cartToken) : req;
};

async function seedCompany(conn, { name, email, host }) {
  const companyId = (
    await conn.execute(
      `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
      { name, id: OUT_ID },
    )
  ).outBinds.id[0];
  await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
    companyId,
    host,
  });
  const passHash = await argon2.hash(password);
  await conn.execute(
    `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
     VALUES (:companyId, :email, :passHash, 'Iso Owner', 'owner', 1)`,
    { companyId, email, passHash },
  );
  await conn.execute('INSERT INTO order_seq (company_id) VALUES (:companyId)', { companyId });
  await conn.commit();
  return companyId;
}

beforeAll(async () => {
  await initPool();

  await withPlatform(async (conn) => {
    companyAId = await seedCompany(conn, { name: `Iso Commerce A ${suffix}`, email: emailA, host: hostA });
    companyBId = await seedCompany(conn, { name: `Iso Commerce B ${suffix}`, email: emailB, host: hostB });
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  const product = (
    await asA(request(app).post('/products')).send({
      name: 'Iso Commerce Steak',
      variants: [{ sku: `ISOCOM-${suffix}`, price: 25, stock: 10 }],
    })
  ).body.product;

  const registerRes = await shopA('post', '/shop/account/register').send({
    email: `iso-customer-a-${suffix}@example.test`,
    password: 'customer pass 123',
    name: 'Iso Customer A',
    phone: '+1 555 0400',
  });
  customerAId = registerRes.body.customer.id;
  const customerTokenA = registerRes.body.accessToken;

  const addrRes = await shopA('post', '/shop/account/addresses')
    .set('Authorization', `Bearer ${customerTokenA}`)
    .send({ name: 'Iso Customer A', phone: '+1 555 0400', line1: '1 Iso St', city: 'Isoville', isDefault: true });
  addrAId = addrRes.body.rows[0].id;

  const cart = await shopA('get', '/shop/cart');
  const cartToken = cart.body.token;
  await shopA('post', '/shop/cart/items', cartToken).send({ variantId: product.variants[0].id, qty: 1 });
  const checkoutRes = await shopA('post', '/shop/checkout', cartToken)
    .set('Authorization', `Bearer ${customerTokenA}`)
    .send({ name: 'Iso Customer A', phone: '+1 555 0400', addrId: addrAId });
  orderAId = checkoutRes.body.order.id;
  orderItemAId = checkoutRes.body.order.items[0].id;
});

afterAll(async () => {
  await getRedis().del(`host:${hostA}`);
  await getRedis().del(`host:${hostB}`);
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyAId, companyBId]);
  });
  await closeRedis();
  await closePool();
});

describe('customers & addresses: cross-company isolation (release gate)', () => {
  it("B cannot read, patch, or see A's customer", async () => {
    expect((await asB(request(app).get(`/customers/${customerAId}`))).status).toBe(404);
    expect((await asB(request(app).patch(`/customers/${customerAId}`)).send({ isActive: false })).status).toBe(404);

    const list = await asB(request(app).get('/customers'));
    expect(list.body.rows.map((c) => c.id)).not.toContain(customerAId);
  });

  it('raw no-predicate SQL under B context cannot see A customers/addrs rows (proves VPD)', async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const customers = await conn.execute('SELECT id FROM customers WHERE id = :id', { id: customerAId });
      const addrs = await conn.execute('SELECT id FROM addrs WHERE id = :id', { id: addrAId });
      return { customers: customers.rows, addrs: addrs.rows };
    });
    expect(seenByB.customers).toHaveLength(0);
    expect(seenByB.addrs).toHaveLength(0);

    const seenByA = await withCompany(companyAId, async (conn) => {
      const customers = await conn.execute('SELECT id FROM customers WHERE id = :id', { id: customerAId });
      return customers.rows;
    });
    expect(seenByA).toHaveLength(1);
  });
});

describe('carts: cross-company isolation (release gate)', () => {
  it("guessing A's exact cart token on B's storefront never returns A's cart", async () => {
    const cartA = await shopA('get', '/shop/cart');
    const tokenValue = cartA.body.token;

    const asBHost = await request(app).get('/shop/cart').set('X-Forwarded-Host', hostB).set('X-Cart-Token', tokenValue);
    expect(asBHost.status).toBe(200);
    // A brand-new, empty cart — never A's items, even though the token string matches exactly.
    expect(asBHost.body.token).not.toBe(tokenValue);
    expect(asBHost.body.items).toEqual([]);
  });

  it('raw no-predicate SQL under B context cannot see A carts rows (proves VPD)', async () => {
    const cartA = await shopA('get', '/shop/cart');
    const seenByB = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute('SELECT id FROM carts WHERE token = :token', { token: cartA.body.token });
      return result.rows;
    });
    expect(seenByB).toHaveLength(0);
  });
});

describe('orders: cross-company isolation (release gate)', () => {
  it("B cannot read, change status of, or edit A's order", async () => {
    expect((await asB(request(app).get(`/orders/${orderAId}`))).status).toBe(404);
    expect((await asB(request(app).patch(`/orders/${orderAId}/status`)).send({ status: 'confirmed' })).status).toBe(404);
    expect((await asB(request(app).patch(`/orders/${orderAId}`)).send({ note: 'hijacked' })).status).toBe(404);
  });

  it("B's order list and export exclude A's orders", async () => {
    const list = await asB(request(app).get('/orders'));
    expect(list.body.rows.map((o) => o.id)).not.toContain(orderAId);

    const csv = await asB(request(app).get('/orders/export'));
    expect(csv.text).not.toContain(String(orderAId));
  });

  it("B's dashboard summary is computed only over B's own orders", async () => {
    const res = await asB(request(app).get('/dashboard/summary'));
    expect(res.status).toBe(200);
    expect(res.body.today.orderCount).toBe(0);
  });

  it('raw no-predicate SQL under B context cannot see A orders/order_items/order_log rows (proves VPD)', async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const orders = await conn.execute('SELECT id FROM orders WHERE id = :id', { id: orderAId });
      const items = await conn.execute('SELECT id FROM order_items WHERE id = :id', { id: orderItemAId });
      const log = await conn.execute('SELECT id FROM order_log WHERE order_id = :orderId', { orderId: orderAId });
      return { orders: orders.rows, items: items.rows, log: log.rows };
    });
    expect(seenByB.orders).toHaveLength(0);
    expect(seenByB.items).toHaveLength(0);
    expect(seenByB.log).toHaveLength(0);

    const seenByA = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute('SELECT id FROM orders WHERE id = :id', { id: orderAId });
      return result.rows;
    });
    expect(seenByA).toHaveLength(1);
  });

  it("a customer authenticated for company A's storefront cannot read another company's order via /shop/account/orders", async () => {
    // Company B has no customer accounts of its own here — this proves the
    // route checks company_id, not just "some customer is logged in".
    const registerB = await request(app)
      .post('/shop/account/register')
      .set('X-Forwarded-Host', hostB)
      .send({ email: `iso-customer-b-${suffix}@example.test`, password: 'another pass 123', name: 'Iso Customer B', phone: '+1 555 0401' });

    const res = await request(app)
      .get(`/shop/account/orders/${orderAId}`)
      .set('X-Forwarded-Host', hostB)
      .set('Authorization', `Bearer ${registerB.body.accessToken}`);
    expect(res.status).toBe(404);
  });
});
