import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-prod-a-${suffix}@example.test`;
const emailB = `iso-prod-b-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let adminAId;
let adminBId;
let tokenA;
let tokenB;

let productAId;
let variantAId;
let imageAId;
let mediaAId;
let catAId;

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);
const asB = (req) => req.set('Authorization', `Bearer ${tokenB}`);

async function seedCompanyWithOwner(conn, { name, email, passHash }) {
  const companyId = (
    await conn.execute(
      `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
      { name, id: OUT_ID },
    )
  ).outBinds.id[0];

  const adminId = (
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Isolation Owner', 'owner', 1) RETURNING id INTO :id`,
      { companyId, email, passHash, id: OUT_ID },
    )
  ).outBinds.id[0];

  return { companyId, adminId };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const a = await seedCompanyWithOwner(conn, { name: `Iso Prod Co A ${suffix}`, email: emailA, passHash });
    companyAId = a.companyId;
    adminAId = a.adminId;

    const b = await seedCompanyWithOwner(conn, { name: `Iso Prod Co B ${suffix}`, email: emailB, passHash });
    companyBId = b.companyId;
    adminBId = b.adminId;

    catAId = (
      await conn.execute(
        `INSERT INTO cats (company_id, name, slug) VALUES (:companyId, 'A Cat', :slug) RETURNING id INTO :id`,
        { companyId: companyAId, slug: `iso-prod-cat-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  const png = await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .png()
    .toBuffer();
  mediaAId = (await asA(request(app).post('/media')).attach('file', png, 'a.png')).body.media.ID;

  const created = await asA(request(app).post('/products')).send({
    name: `A Private Product ${suffix}`,
    catIds: [catAId],
    variants: [{ sku: `A-SKU-${suffix}`, price: 10, stock: 5 }],
  });
  productAId = created.body.product.id;
  variantAId = created.body.product.variants[0].id;

  const withImage = await asA(request(app).post(`/products/${productAId}/images`)).send({ mediaId: mediaAId });
  imageAId = withImage.body.rows[0].id;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    const companies = { a: companyAId, b: companyBId };
    for (const sql of [
      'DELETE FROM prod_imgs WHERE company_id IN (:a, :b)',
      'DELETE FROM prod_cats WHERE company_id IN (:a, :b)',
      'DELETE FROM options WHERE company_id IN (:a, :b)',
      'DELETE FROM variants WHERE company_id IN (:a, :b)',
      'DELETE FROM products WHERE company_id IN (:a, :b)',
      'DELETE FROM cats WHERE company_id IN (:a, :b)',
      'DELETE FROM media WHERE company_id IN (:a, :b)',
      'DELETE FROM logs WHERE company_id IN (:a, :b)',
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

describe('products: cross-company isolation (release gate)', () => {
  it("B reads A's product -> 404", async () => {
    const res = await asB(request(app).get(`/products/${productAId}`));
    expect(res.status).toBe(404);
  });

  it("B updates A's product -> 404", async () => {
    const res = await asB(request(app).patch(`/products/${productAId}`)).send({ name: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it("B deletes A's product -> 404, and A's product survives", async () => {
    const res = await asB(request(app).delete(`/products/${productAId}`));
    expect(res.status).toBe(404);

    const stillThere = await asA(request(app).get(`/products/${productAId}`));
    expect(stillThere.status).toBe(200);
  });

  it("B lists products -> A's rows never appear", async () => {
    const res = await asB(request(app).get('/products?pageSize=100'));
    expect(res.status).toBe(200);
    expect(res.body.rows.some((row) => row.id === productAId)).toBe(false);
    expect(res.body.total).toBe(0);
  });

  it("B searches for A's SKU -> nothing", async () => {
    const res = await asB(request(app).get(`/products?search=A-SKU-${suffix}`));
    expect(res.body.rows).toHaveLength(0);
  });

  it("B filters by A's category id -> nothing", async () => {
    const res = await asB(request(app).get(`/products?catId=${catAId}`));
    expect(res.body.rows).toHaveLength(0);
  });

  it("B bulk-deletes A's ids -> reports zero affected and changes nothing", async () => {
    const res = await asB(request(app).post('/products/bulk')).send({
      ids: [productAId],
      action: 'delete',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requested: 1, affected: 0 });

    const stillThere = await asA(request(app).get(`/products/${productAId}`));
    expect(stillThere.status).toBe(200);
  });

  it("B reads A's variants -> 404", async () => {
    const res = await asB(request(app).get(`/products/${productAId}/variants`));
    expect(res.status).toBe(404);
  });

  it("B adjusts stock on A's variant -> 404, and the stock is unchanged", async () => {
    const res = await asB(
      request(app).post(`/products/${productAId}/variants/${variantAId}/stock`),
    ).send({ delta: -5 });
    expect(res.status).toBe(404);

    const asOwner = await asA(request(app).get(`/products/${productAId}`));
    expect(asOwner.body.product.variants[0].stock).toBe(5);
  });

  it("B deletes A's variant -> 404", async () => {
    const res = await asB(request(app).delete(`/products/${productAId}/variants/${variantAId}`));
    expect(res.status).toBe(404);
  });

  it("B reads or reorders A's images -> 404", async () => {
    expect((await asB(request(app).get(`/products/${productAId}/images`))).status).toBe(404);

    const res = await asB(request(app).post(`/products/${productAId}/images/reorder`)).send({
      items: [{ id: imageAId, position: 5 }],
    });
    expect(res.status).toBe(404);
  });

  it("B cannot attach A's media to B's own product", async () => {
    const own = await asB(request(app).post('/products')).send({ name: `B Own ${suffix}` });
    expect(own.status).toBe(201);

    const res = await asB(request(app).post(`/products/${own.body.product.id}/images`)).send({
      mediaId: mediaAId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_NOT_FOUND');
  });

  it("B cannot file its own product under A's category", async () => {
    const own = await asB(request(app).post('/products')).send({ name: `B Own Cat ${suffix}` });
    const res = await asB(request(app).put(`/products/${own.body.product.id}/cats`)).send({
      catIds: [catAId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CAT_NOT_FOUND');
  });

  it("B may reuse A's SKU (unique per company, not globally)", async () => {
    const res = await asB(request(app).post('/products')).send({
      name: `B Same Sku ${suffix}`,
      variants: [{ sku: `A-SKU-${suffix}`, price: 1 }],
    });
    expect(res.status).toBe(201);
  });

  it('raw no-predicate SQL under B context reaches none of A rows (proves VPD, not the repo WHERE)', async () => {
    const tables = [
      ['products', productAId],
      ['variants', variantAId],
      ['prod_imgs', imageAId],
    ];

    for (const [table, id] of tables) {
      const seenByB = await withCompany(companyBId, async (conn) => {
        const result = await conn.execute(`SELECT id FROM ${table} WHERE id = :id`, { id });
        return result.rows;
      });
      expect(seenByB, `${table} leaked to B`).toHaveLength(0);

      const seenByA = await withCompany(companyAId, async (conn) => {
        const result = await conn.execute(`SELECT id FROM ${table} WHERE id = :id`, { id });
        return result.rows;
      });
      expect(seenByA, `${table} invisible to its owner`).toHaveLength(1);
    }
  });

  it("B's audit log never records an action against A's product", async () => {
    const rows = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `SELECT company_id FROM logs WHERE entity = 'product' AND entity_id = :id`,
        { id: productAId },
      );
      return result.rows;
    });
    expect(rows.every((row) => row.COMPANY_ID === companyAId)).toBe(true);
  });
});
