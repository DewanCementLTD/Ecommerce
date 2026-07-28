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
const adminEmail = `cart-owner-${suffix}@example.test`;
const host = `cart-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let adminToken;
let companyId;
let variantId;
let variantId2;

const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);
const shop = (method, path, token) => {
  const req = request(app)[method](path).set('X-Forwarded-Host', host);
  return token ? req.set('X-Cart-Token', token) : req;
};

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(adminPassword);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Cart Co ${suffix}`, id: OUT_ID },
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
    await conn.commit();
  });

  app = createApp();
  adminToken = (await request(app).post('/auth/login').send({ email: adminEmail, password: adminPassword })).body
    .accessToken;

  const product = (
    await asAdmin(request(app).post('/products')).send({
      name: 'Cart Test Steak',
      variants: [{ sku: `CART-${suffix}`, price: 20, stock: 3 }],
    })
  ).body.product;
  variantId = product.variants[0].id;

  const product2 = (
    await asAdmin(request(app).post('/products')).send({
      name: 'Cart Test Sausage',
      variants: [{ sku: `CART2-${suffix}`, price: 8, stock: 0, isActive: 1 }],
    })
  ).body.product;
  variantId2 = product2.variants[0].id;
});

afterAll(async () => {
  await getRedis().del(`host:${host}`);
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyId]);
  });
  await closeRedis();
  await closePool();
});

describe('cart', () => {
  let token;

  it('creates a cart on first read, with no token', async () => {
    const res = await shop('get', '/shop/cart');
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.items).toEqual([]);
    token = res.body.token;
  });

  it('adds an item', async () => {
    const res = await shop('post', '/shop/cart/items', token).send({ variantId, qty: 2 });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ variantId, qty: 2, currentPrice: 20 });
    expect(res.body.subtotal).toBe(40);
  });

  it('adding the same variant again merges quantities rather than duplicating the line', async () => {
    const res = await shop('post', '/shop/cart/items', token).send({ variantId, qty: 1 });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].qty).toBe(3);
  });

  it('rejects adding more than is in stock', async () => {
    const res = await shop('post', '/shop/cart/items', token).send({ variantId, qty: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects adding an out-of-stock variant at all', async () => {
    const res = await shop('post', '/shop/cart/items', token).send({ variantId: variantId2, qty: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('updates a line quantity', async () => {
    const cart = await shop('get', '/shop/cart', token);
    const itemId = cart.body.items[0].id;
    const res = await shop('patch', `/shop/cart/items/${itemId}`, token).send({ qty: 1 });
    expect(res.status).toBe(200);
    expect(res.body.items[0].qty).toBe(1);
    expect(res.body.subtotal).toBe(20);
  });

  it('a different (unknown) cart token gets its own empty cart, never someone else\'s', async () => {
    const res = await shop('get', '/shop/cart', 'not-a-real-token-00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.token).not.toBe(token);
  });

  it('removes a line', async () => {
    const cart = await shop('get', '/shop/cart', token);
    const itemId = cart.body.items[0].id;
    const res = await shop('delete', `/shop/cart/items/${itemId}`, token);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('flags a price change instead of silently repricing the cart', async () => {
    await shop('post', '/shop/cart/items', token).send({ variantId, qty: 1 });
    const cartBefore = await shop('get', '/shop/cart', token);
    const productId = cartBefore.body.items[0].product.id;

    await asAdmin(request(app).patch(`/products/${productId}/variants/${variantId}`)).send({ price: 25 });

    const res = await shop('get', '/shop/cart', token);
    expect(res.body.items[0].priceSnap).toBe(20);
    expect(res.body.items[0].currentPrice).toBe(25);
    expect(res.body.items[0].priceChanged).toBe(true);
  });

  it('clears the whole cart', async () => {
    const res = await shop('delete', '/shop/cart', token);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
