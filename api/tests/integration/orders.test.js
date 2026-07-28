import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const adminPassword = 'correct horse battery staple';
const adminEmail = `order-owner-${suffix}@example.test`;
const host = `order-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let adminToken;
let companyId;

const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);
const shop = (method, path, token) => {
  const req = request(app)[method](path).set('X-Forwarded-Host', host);
  return token ? req.set('X-Cart-Token', token) : req;
};

async function addToCart(token, variantId, qty) {
  const res = await shop('post', '/shop/cart/items', token).send({ variantId, qty });
  return res.body.token;
}

async function newVariant(name, price, stock) {
  const product = (
    await asAdmin(request(app).post('/products')).send({
      name,
      variants: [{ sku: `${name}-${suffix}`.replace(/\s+/g, '-'), price, stock }],
    })
  ).body.product;
  return { productId: product.id, variantId: product.variants[0].id };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(adminPassword);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Order Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];
    await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
      companyId,
      host,
    });
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Owner', 'owner', 1)`,
      { companyId, email: adminEmail, passHash },
    );
    await conn.execute('INSERT INTO order_seq (company_id) VALUES (:companyId)', { companyId });
    await conn.commit();
  });

  app = createApp();
  adminToken = (await request(app).post('/auth/login').send({ email: adminEmail, password: adminPassword })).body
    .accessToken;
});

afterAll(async () => {
  await getRedis().del(`sf:host:${host}`);
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyId]);
  });
  await closeRedis();
  await closePool();
});

describe('checkout', () => {
  it('places a guest order, decrements stock, and clears the cart', async () => {
    const { productId, variantId } = await newVariant('Checkout Steak', 30, 5);
    const token = await addToCart(null, variantId, 2);

    const res = await shop('post', '/shop/checkout', token).send({
      name: 'Guest Buyer',
      phone: '+1 555 0200',
      address: { line1: '1 Test St', city: 'Testville' },
    });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: 'new', subtotal: 60, total: 60 });
    expect(res.body.order.orderNo).toBeGreaterThanOrEqual(1001);
    expect(res.body.order.items).toHaveLength(1);
    expect(res.body.order.items[0]).toMatchObject({ qty: 2, priceSnap: 30, lineTotal: 60 });

    const productRes = await asAdmin(request(app).get(`/products/${productId}`));
    expect(productRes.body.product.variants[0].stock).toBe(3);

    const cartRes = await shop('get', '/shop/cart', token);
    expect(cartRes.body.items).toEqual([]);
  });

  it('rejects checkout with an empty cart', async () => {
    const cart = await shop('get', '/shop/cart');
    const res = await shop('post', '/shop/checkout', cart.body.token).send({
      name: 'Nobody',
      phone: '+1 555 0201',
      address: { line1: '1 Test St', city: 'Testville' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CART_EMPTY');
  });

  it('rejects checkout when stock ran out since the item was added', async () => {
    const { variantId } = await newVariant('Scarce Item', 10, 1);
    const token = await addToCart(null, variantId, 1);
    // A second buyer takes the last unit first.
    await withPlatform(async (conn) => {
      await conn.execute('UPDATE variants SET stock = 0 WHERE id = :id', { id: variantId });
      await conn.commit();
    });

    const res = await shop('post', '/shop/checkout', token).send({
      name: 'Late Buyer',
      phone: '+1 555 0202',
      address: { line1: '1 Test St', city: 'Testville' },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('renaming or repricing a product afterwards never changes an existing order', async () => {
    const { productId, variantId } = await newVariant('Renamable Item', 15, 5);
    const token = await addToCart(null, variantId, 1);
    const checkoutRes = await shop('post', '/shop/checkout', token).send({
      name: 'Snapshot Buyer',
      phone: '+1 555 0203',
      address: { line1: '1 Test St', city: 'Testville' },
    });
    const orderId = checkoutRes.body.order.id;

    await asAdmin(request(app).patch(`/products/${productId}`)).send({ name: 'Renamed Item' });
    await asAdmin(request(app).patch(`/products/${productId}/variants/${variantId}`)).send({ price: 999 });

    const after = await asAdmin(request(app).get(`/orders/${orderId}`));
    expect(after.body.order.items[0].nameSnap).toBe('Renamable Item');
    expect(after.body.order.items[0].priceSnap).toBe(15);
    expect(after.body.order.total).toBe(15);
  });

  it('an idempotency key replays the same order instead of creating a duplicate', async () => {
    const { variantId } = await newVariant('Idempotent Item', 12, 5);
    const token = await addToCart(null, variantId, 1);
    const idemKey = `idem-${suffix}-1`;

    const first = await shop('post', '/shop/checkout', token)
      .set('Idempotency-Key', idemKey)
      .send({ name: 'Idem Buyer', phone: '+1 555 0204', address: { line1: '1 Test St', city: 'Testville' } });
    expect(first.status).toBe(201);

    // Re-adding to cart and retrying with the same key must not double-charge stock.
    await addToCart(token, variantId, 1);
    const second = await shop('post', '/shop/checkout', token)
      .set('Idempotency-Key', idemKey)
      .send({ name: 'Idem Buyer', phone: '+1 555 0204', address: { line1: '1 Test St', city: 'Testville' } });
    expect(second.status).toBe(201);
    expect(second.body.order.id).toBe(first.body.order.id);
  });

  it('cannot oversell the last unit under concurrent checkouts', async () => {
    const { variantId } = await newVariant('Contested Item', 40, 1);
    const tokenA = await addToCart(null, variantId, 1);
    const tokenB = await addToCart(null, variantId, 1);

    const payload = (name) => ({ name, phone: '+1 555 0205', address: { line1: '1 Test St', city: 'Testville' } });
    const [resA, resB] = await Promise.all([
      shop('post', '/shop/checkout', tokenA).send(payload('Racer A')),
      shop('post', '/shop/checkout', tokenB).send(payload('Racer B')),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = resA.status === 201 ? resA : resB;
    expect(winner.body.order.items[0].qty).toBe(1);
  });
});

describe('admin order management', () => {
  let orderId;

  beforeAll(async () => {
    const { variantId } = await newVariant('Status Flow Item', 22, 5);
    const token = await addToCart(null, variantId, 1);
    const res = await shop('post', '/shop/checkout', token).send({
      name: 'Status Buyer',
      phone: '+1 555 0206',
      address: { line1: '1 Test St', city: 'Testville' },
    });
    orderId = res.body.order.id;
  });

  it('lists orders for the company', async () => {
    const res = await asAdmin(request(app).get('/orders'));
    expect(res.status).toBe(200);
    expect(res.body.rows.some((o) => o.id === orderId)).toBe(true);
  });

  it('rejects an invalid status transition', async () => {
    const res = await asAdmin(request(app).patch(`/orders/${orderId}/status`)).send({ status: 'delivered' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('confirms then delivers, in order, logging each transition', async () => {
    const confirm = await asAdmin(request(app).patch(`/orders/${orderId}/status`)).send({ status: 'confirmed' });
    expect(confirm.status).toBe(200);
    expect(confirm.body.order.status).toBe('confirmed');

    const deliver = await asAdmin(request(app).patch(`/orders/${orderId}/status`)).send({ status: 'delivered', note: 'Left at door' });
    expect(deliver.status).toBe(200);
    expect(deliver.body.order.log.map((l) => l.toStatus)).toEqual(['new', 'confirmed', 'delivered']);
  });

  it('refuses to move a delivered order anywhere', async () => {
    const res = await asAdmin(request(app).patch(`/orders/${orderId}/status`)).send({ status: 'cancelled' });
    expect(res.status).toBe(409);
  });

  it('edits contact info and note, never prices', async () => {
    const res = await asAdmin(request(app).patch(`/orders/${orderId}`)).send({ note: 'Call before delivering' });
    expect(res.status).toBe(200);
    expect(res.body.order.note).toBe('Call before delivering');
  });

  it('exports orders as CSV', async () => {
    const res = await asAdmin(request(app).get('/orders/export'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Order #');
  });
});

describe('zero payment-gateway code', () => {
  it('the checkout response never mentions payment, gateway, or transaction ids', async () => {
    const { variantId } = await newVariant('Plain COD Item', 5, 5);
    const token = await addToCart(null, variantId, 1);
    const res = await shop('post', '/shop/checkout', token).send({
      name: 'COD Buyer',
      phone: '+1 555 0207',
      address: { line1: '1 Test St', city: 'Testville' },
    });
    const serialized = JSON.stringify(res.body).toLowerCase();
    expect(serialized).not.toMatch(/payment|gateway|stripe|paypal/);
  });
});
