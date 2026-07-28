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
const adminEmail = `dash-owner-${suffix}@example.test`;
const host = `dash-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let adminToken;
let companyId;

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
        { name: `Dash Co ${suffix}`, id: OUT_ID },
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

  const lowStockProduct = (
    await asAdmin(request(app).post('/products')).send({
      name: 'Low Stock Item',
      variants: [{ sku: `LOW-${suffix}`, price: 9, stock: 2 }],
    })
  ).body.product;

  const soldProduct = (
    await asAdmin(request(app).post('/products')).send({
      name: 'Best Seller Item',
      variants: [{ sku: `BEST-${suffix}`, price: 18, stock: 20 }],
    })
  ).body.product;

  const cart = await shop('get', '/shop/cart');
  await shop('post', '/shop/cart/items', cart.body.token).send({ variantId: soldProduct.variants[0].id, qty: 3 });
  await shop('post', '/shop/checkout', cart.body.token).send({
    name: 'Dashboard Buyer',
    phone: '+1 555 0300',
    address: { line1: '1 Test St', city: 'Testville' },
  });

  void lowStockProduct;
});

afterAll(async () => {
  await getRedis().del(`sf:host:${host}`);
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyId]);
  });
  await closeRedis();
  await closePool();
});

describe('dashboard summary', () => {
  it('reports today/7d/30d order counts and revenue', async () => {
    const res = await asAdmin(request(app).get('/dashboard/summary'));
    expect(res.status).toBe(200);
    expect(res.body.today.orderCount).toBeGreaterThanOrEqual(1);
    expect(res.body.today.revenue).toBeGreaterThanOrEqual(54);
    expect(res.body.last30Days.orderCount).toBeGreaterThanOrEqual(1);
  });

  it('flags the low-stock variant under the default threshold', async () => {
    const res = await asAdmin(request(app).get('/dashboard/summary'));
    expect(res.body.lowStock.some((v) => v.sku === `LOW-${suffix}`)).toBe(true);
  });

  it('lists the just-placed order in top products by quantity', async () => {
    const res = await asAdmin(request(app).get('/dashboard/summary'));
    expect(res.body.topProducts.some((p) => p.name.includes('Best Seller Item') && p.qty >= 3)).toBe(true);
  });

  it('has a revenue series covering the last 30 days', async () => {
    const res = await asAdmin(request(app).get('/dashboard/summary'));
    expect(Array.isArray(res.body.revenueSeries)).toBe(true);
    expect(res.body.revenueSeries.length).toBeGreaterThan(0);
  });
});
