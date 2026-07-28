import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';

/**
 * The public storefront is the one surface with no authentication at all: the
 * only thing separating two stores is the Host header. These tests drive both
 * hosts against the same running app and check that nothing crosses.
 */

const suffix = Date.now();
const password = 'correct horse battery staple';
const hostA = `iso-shop-a-${suffix}.localhost`;
const hostB = `iso-shop-b-${suffix}.localhost`;
const emailA = `iso-shop-a-${suffix}@example.test`;
const emailB = `iso-shop-b-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/** Deliberately identical in both stores, so only the tenant boundary decides. */
const SHARED_SLUG = `house-special-${suffix}`;
const SHARED_CAT_SLUG = `house-cat-${suffix}`;

let app;
let companyAId;
let companyBId;
let adminAId;
let adminBId;
let tokenA;
let tokenB;
let productA;
let productB;
let collA;

const fromA = (path) => request(app).get(path).set('X-Forwarded-Host', hostA);
const fromB = (path) => request(app).get(path).set('X-Forwarded-Host', hostB);

async function seedStore(conn, { name, host, email, passHash }) {
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

  const adminId = (
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Iso Owner', 'owner', 1) RETURNING id INTO :id`,
      { companyId, email, passHash, id: OUT_ID },
    )
  ).outBinds.id[0];

  return { companyId, adminId };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    ({ companyId: companyAId, adminId: adminAId } = await seedStore(conn, {
      name: `Iso Shop A ${suffix}`,
      host: hostA,
      email: emailA,
      passHash,
    }));
    ({ companyId: companyBId, adminId: adminBId } = await seedStore(conn, {
      name: `Iso Shop B ${suffix}`,
      host: hostB,
      email: emailB,
      passHash,
    }));
    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  const seedCatalog = async (token, label) => {
    const cat = await request(app)
      .post('/cats')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `House ${label}`, slug: SHARED_CAT_SLUG });

    const product = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `House Special ${label}`,
        slug: SHARED_SLUG,
        catIds: [cat.body.cat.id],
        variants: [{ sku: `HS-${label}-${suffix}`, price: label === 'A' ? 11 : 22, stock: 3 }],
      });

    return product.body.product;
  };

  productA = await seedCatalog(tokenA, 'A');
  productB = await seedCatalog(tokenB, 'B');

  collA = (
    await request(app)
      .post('/colls')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `A Coll ${suffix}`, productIds: [productA.id] })
  ).body.coll;
});

afterAll(async () => {
  await getRedis().del(`host:${hostA}`);
  await getRedis().del(`host:${hostB}`);

  await withPlatform(async (conn) => {
    const companies = { a: companyAId, b: companyBId };
    for (const sql of [
      'DELETE FROM coll_prods WHERE company_id IN (:a, :b)',
      'DELETE FROM colls WHERE company_id IN (:a, :b)',
      'DELETE FROM prod_cats WHERE company_id IN (:a, :b)',
      'DELETE FROM variants WHERE company_id IN (:a, :b)',
      'DELETE FROM products WHERE company_id IN (:a, :b)',
      'DELETE FROM cats WHERE company_id IN (:a, :b)',
      'DELETE FROM logs WHERE company_id IN (:a, :b)',
      'DELETE FROM domains WHERE company_id IN (:a, :b)',
    ]) {
      await conn.execute(sql, companies);
    }
    await conn.execute('DELETE FROM admins WHERE id IN (:a, :b)', { a: adminAId, b: adminBId });
    await conn.execute('DELETE FROM companies WHERE id IN (:a, :b)', companies);
    await conn.commit();
  });

  await closeRedis();
  await closePool();
});

describe('shop: the host header is the only tenant boundary (release gate)', () => {
  it('the same slug on two hosts returns two different products', async () => {
    const a = await fromA(`/shop/products/${SHARED_SLUG}`);
    const b = await fromB(`/shop/products/${SHARED_SLUG}`);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.product.id).toBe(productA.id);
    expect(b.body.product.id).toBe(productB.id);
    expect(a.body.product.id).not.toBe(b.body.product.id);
    expect(a.body.product.defaultVariant.price).toBe(11);
    expect(b.body.product.defaultVariant.price).toBe(22);
  });

  it("B's listing contains none of A's products", async () => {
    const res = await fromB('/shop/products?pageSize=48');
    expect(res.status).toBe(200);
    expect(res.body.rows.map((row) => row.id)).not.toContain(productA.id);
    expect(res.body.total).toBe(1);
  });

  it("B's search for A's SKU and name finds nothing of A's", async () => {
    const bySku = await fromB(`/shop/search?q=HS-A-${suffix}`);
    expect(bySku.body.rows).toHaveLength(0);

    const byName = await fromB('/shop/search?q=House Special A');
    expect(byName.body.rows.map((row) => row.id)).not.toContain(productA.id);
  });

  it('the shared category slug resolves to each store’s own category and products', async () => {
    const a = await fromA(`/shop/cats/${SHARED_CAT_SLUG}`);
    const b = await fromB(`/shop/cats/${SHARED_CAT_SLUG}`);

    expect(a.body.cat.name).toBe('House A');
    expect(b.body.cat.name).toBe('House B');
    expect(a.body.products.rows.map((row) => row.id)).toEqual([productA.id]);
    expect(b.body.products.rows.map((row) => row.id)).toEqual([productB.id]);
  });

  it("B cannot reach A's collection by slug", async () => {
    expect((await fromB(`/shop/colls/${collA.slug}`)).status).toBe(404);
    expect((await fromA(`/shop/colls/${collA.slug}`)).status).toBe(200);
  });

  it("B's category tree contains none of A's categories", async () => {
    const res = await fromB('/shop/cats');
    const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const names = flatten(res.body.tree).map((node) => node.name);
    expect(names).toContain('House B');
    expect(names).not.toContain('House A');
  });

  it("B's sitemap lists none of A's paths, and vice versa", async () => {
    const a = await fromA('/shop/sitemap');
    const b = await fromB('/shop/sitemap');

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const pathsA = a.body.urls.map((url) => url.path);
    const pathsB = b.body.urls.map((url) => url.path);

    // Both stores own a product and a category at the *same* slug, so a leak
    // here would not show up as an unfamiliar path — only the counts and the
    // collection (which only A has) can tell the two apart.
    expect(pathsA).toContain(`/products/${SHARED_SLUG}`);
    expect(pathsB).toContain(`/products/${SHARED_SLUG}`);
    expect(pathsA).toContain(`/colls/${collA.slug}`);
    expect(pathsB).not.toContain(`/colls/${collA.slug}`);

    expect(pathsA.filter((path) => path.startsWith('/products/'))).toHaveLength(1);
    expect(pathsB.filter((path) => path.startsWith('/products/'))).toHaveLength(1);
  });

  it("B's canonical domain is B's own, never A's", async () => {
    const a = await request(app).get('/storefront/company').set('X-Forwarded-Host', hostA);
    const b = await request(app).get('/storefront/company').set('X-Forwarded-Host', hostB);

    expect(a.body.company.primaryHost).toBe(hostA);
    expect(b.body.company.primaryHost).toBe(hostB);
  });

  it('an unknown host gets 404 rather than any store’s catalog', async () => {
    const res = await request(app)
      .get('/shop/products')
      .set('X-Forwarded-Host', `nothing-here-${suffix}.invalid`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SITE_NOT_FOUND');
  });

  it('a request with no host header does not fall back to some default store', async () => {
    const res = await request(app).get('/shop/products').set('X-Forwarded-Host', '');
    expect([404, 503]).toContain(res.status);
    expect(res.body.rows).toBeUndefined();
  });

  it('suspending A leaves B serving normally', async () => {
    await withPlatform(async (conn) => {
      await conn.execute(`UPDATE companies SET status = 'suspended' WHERE id = :id`, { id: companyAId });
      await conn.commit();
    });

    try {
      expect((await fromA('/shop/products')).status).toBe(503);
      expect((await fromB('/shop/products')).status).toBe(200);
    } finally {
      await withPlatform(async (conn) => {
        await conn.execute(`UPDATE companies SET status = 'active' WHERE id = :id`, { id: companyAId });
        await conn.commit();
      });
    }
  });
});
