import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `colls-owner-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let companyId;
let catId;
let beef;
let lamb;
let chicken;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

async function createProduct(body) {
  const res = await auth(request(app).post('/products')).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.product;
}

async function createColl(body) {
  const res = await auth(request(app).post('/colls')).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.coll;
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Colls Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Colls Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );

    catId = (
      await conn.execute(
        `INSERT INTO cats (company_id, name, slug) VALUES (:companyId, 'Premium', :slug)
         RETURNING id INTO :id`,
        { companyId, slug: `premium-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;

  beef = await createProduct({
    name: `Beef ${suffix}`,
    brand: 'Highland',
    tags: ['grill', 'premium'],
    isFeatured: true,
    catIds: [catId],
    variants: [{ price: 40 }],
  });
  lamb = await createProduct({
    name: `Lamb ${suffix}`,
    brand: 'Highland',
    tags: ['roast'],
    variants: [{ price: 25 }],
  });
  chicken = await createProduct({
    name: `Chicken ${suffix}`,
    brand: 'Valley',
    tags: ['grill'],
    variants: [{ price: 9 }],
  });
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM coll_prods WHERE company_id = :companyId',
      'DELETE FROM colls WHERE company_id = :companyId',
      'DELETE FROM prod_cats WHERE company_id = :companyId',
      'DELETE FROM variants WHERE company_id = :companyId',
      'DELETE FROM products WHERE company_id = :companyId',
      'DELETE FROM cats WHERE company_id = :companyId',
      'DELETE FROM logs WHERE company_id = :companyId',
      'DELETE FROM admins WHERE company_id = :companyId',
      'DELETE FROM companies WHERE id = :companyId',
    ]) {
      await conn.execute(sql, { companyId });
    }
    await conn.commit();
  });
  await closeRedis();
  await closePool();
});

describe('manual collections', () => {
  it('creates one with an ordered product list', async () => {
    const coll = await createColl({
      name: `Summer Grill ${suffix}`,
      productIds: [chicken.id, beef.id],
    });
    expect(coll.type).toBe('manual');
    expect(coll.slug).toBe(`summer-grill-${suffix}`);

    const members = await auth(request(app).get(`/colls/${coll.id}/products`));
    expect(members.body.rows.map((row) => row.id)).toEqual([chicken.id, beef.id]);
    expect(members.body.rows[0].defaultVariant.price).toBe(9);
  });

  it('replaces and reorders membership', async () => {
    const coll = await createColl({ name: `Reorderable ${suffix}`, productIds: [beef.id, lamb.id] });

    const replaced = await auth(request(app).put(`/colls/${coll.id}/products`)).send({
      productIds: [lamb.id, chicken.id, beef.id],
    });
    expect(replaced.body.rows.map((row) => row.id)).toEqual([lamb.id, chicken.id, beef.id]);

    const reordered = await auth(request(app).post(`/colls/${coll.id}/products/reorder`)).send({
      items: [
        { productId: beef.id, position: 0 },
        { productId: lamb.id, position: 1 },
        { productId: chicken.id, position: 2 },
      ],
    });
    expect(reordered.body.rows.map((row) => row.id)).toEqual([beef.id, lamb.id, chicken.id]);
  });

  it('reports a product count on the listing', async () => {
    const coll = await createColl({ name: `Counted ${suffix}`, productIds: [beef.id] });
    const list = await auth(request(app).get(`/colls?search=Counted ${suffix}`));
    expect(list.body.rows.find((row) => row.id === coll.id).productCount).toBe(1);
  });

  it('rejects a product from another store', async () => {
    const coll = await createColl({ name: `Foreign ${suffix}` });
    const res = await auth(request(app).put(`/colls/${coll.id}/products`)).send({
      productIds: [999_999_999],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects reordering a product that is not a member', async () => {
    const coll = await createColl({ name: `Stranger ${suffix}`, productIds: [beef.id] });
    const res = await auth(request(app).post(`/colls/${coll.id}/products/reorder`)).send({
      items: [{ productId: lamb.id, position: 0 }],
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PRODUCT_NOT_IN_COLL');
  });

  it('deletes, unlinking members without deleting products', async () => {
    const coll = await createColl({ name: `Doomed ${suffix}`, productIds: [beef.id, lamb.id] });
    const res = await auth(request(app).delete(`/colls/${coll.id}`));
    expect(res.status).toBe(200);
    expect(res.body.unlinkedProducts).toBe(2);

    expect((await auth(request(app).get(`/colls/${coll.id}`))).status).toBe(404);
    expect((await auth(request(app).get(`/products/${beef.id}`))).status).toBe(200);
  });
});

describe('automatic collections', () => {
  it('matches by brand', async () => {
    const coll = await createColl({
      name: `Highland only ${suffix}`,
      type: 'auto',
      rules: { match: 'all', conditions: [{ field: 'brand', op: 'eq', value: 'Highland' }] },
    });

    const members = await auth(request(app).get(`/colls/${coll.id}/products`));
    const ids = members.body.rows.map((row) => row.id);
    expect(ids).toContain(beef.id);
    expect(ids).toContain(lamb.id);
    expect(ids).not.toContain(chicken.id);
  });

  it('matches by tag', async () => {
    const coll = await createColl({
      name: `Grillables ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'tag', op: 'eq', value: 'grill' }] },
    });
    const ids = (await auth(request(app).get(`/colls/${coll.id}/products`))).body.rows.map((r) => r.id);
    expect(ids.sort()).toEqual([beef.id, chicken.id].sort());
  });

  it('matches by category and price together (match: all)', async () => {
    const coll = await createColl({
      name: `Premium pricey ${suffix}`,
      type: 'auto',
      rules: {
        match: 'all',
        conditions: [
          { field: 'cat_id', op: 'eq', value: catId },
          { field: 'price', op: 'gt', value: 30 },
        ],
      },
    });
    const ids = (await auth(request(app).get(`/colls/${coll.id}/products`))).body.rows.map((r) => r.id);
    expect(ids).toEqual([beef.id]);
  });

  it('honours match: any', async () => {
    const coll = await createColl({
      name: `Either ${suffix}`,
      type: 'auto',
      rules: {
        match: 'any',
        conditions: [
          { field: 'brand', op: 'eq', value: 'Valley' },
          { field: 'is_featured', op: 'eq', value: true },
        ],
      },
    });
    const ids = (await auth(request(app).get(`/colls/${coll.id}/products`))).body.rows.map((r) => r.id);
    expect(ids.sort()).toEqual([beef.id, chicken.id].sort());
  });

  it('supports in and neq', async () => {
    const inColl = await createColl({
      name: `In brands ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'brand', op: 'in', value: ['Valley', 'Nobody'] }] },
    });
    expect((await auth(request(app).get(`/colls/${inColl.id}/products`))).body.rows.map((r) => r.id)).toEqual([
      chicken.id,
    ]);

    const neqColl = await createColl({
      name: `Not premium ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'cat_id', op: 'neq', value: catId }] },
    });
    const ids = (await auth(request(app).get(`/colls/${neqColl.id}/products`))).body.rows.map((r) => r.id);
    expect(ids).not.toContain(beef.id);
    expect(ids).toContain(lamb.id);
  });

  it('reflects a product change without touching the collection', async () => {
    const coll = await createColl({
      name: `Live ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'tag', op: 'eq', value: 'seasonal' }] },
    });
    expect((await auth(request(app).get(`/colls/${coll.id}/products`))).body.total).toBe(0);

    await auth(request(app).patch(`/products/${lamb.id}`)).send({ tags: ['roast', 'seasonal'] });

    const after = await auth(request(app).get(`/colls/${coll.id}/products`));
    expect(after.body.rows.map((r) => r.id)).toEqual([lamb.id]);
  });

  it('rejects an unknown field, a bad operator, and a missing rule set', async () => {
    const unknownField = await auth(request(app).post('/colls')).send({
      name: `Bad field ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'colour', op: 'eq', value: 'red' }] },
    });
    expect(unknownField.status).toBe(400);

    const badOp = await auth(request(app).post('/colls')).send({
      name: `Bad op ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'tag', op: 'gt', value: 'grill' }] },
    });
    expect(badOp.status).toBe(400);
    expect(badOp.body.error.code).toBe('INVALID_RULE');

    const noRules = await auth(request(app).post('/colls')).send({
      name: `No rules ${suffix}`,
      type: 'auto',
    });
    expect(noRules.status).toBe(400);
  });

  it('refuses hand-picking on an automatic collection', async () => {
    const coll = await createColl({
      name: `Hands off ${suffix}`,
      type: 'auto',
      rules: { conditions: [{ field: 'brand', op: 'eq', value: 'Highland' }] },
    });

    const res = await auth(request(app).put(`/colls/${coll.id}/products`)).send({ productIds: [beef.id] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COLL_IS_AUTOMATIC');
  });

  it('drops the hand-picked list when switching manual to auto', async () => {
    const coll = await createColl({ name: `Switching ${suffix}`, productIds: [beef.id, lamb.id] });

    await auth(request(app).patch(`/colls/${coll.id}`)).send({
      type: 'auto',
      rules: { conditions: [{ field: 'brand', op: 'eq', value: 'Valley' }] },
    });

    const members = await auth(request(app).get(`/colls/${coll.id}/products`));
    expect(members.body.rows.map((r) => r.id)).toEqual([chicken.id]);

    const leftovers = await withPlatform(async (conn) => {
      const result = await conn.execute('SELECT COUNT(*) AS cnt FROM coll_prods WHERE coll_id = :id', {
        id: coll.id,
      });
      return result.rows[0].CNT;
    });
    expect(leftovers).toBe(0);
  });
});

describe('collection basics', () => {
  it('suffixes duplicate slugs and filters the listing by type', async () => {
    const first = await createColl({ name: `Twin ${suffix}` });
    const second = await createColl({ name: `Twin ${suffix}` });
    expect(second.slug).toBe(`${first.slug}-2`);

    const autos = await auth(request(app).get('/colls?type=auto&pageSize=100'));
    expect(autos.body.rows.every((row) => row.type === 'auto')).toBe(true);
  });

  it('404s an unknown collection', async () => {
    expect((await auth(request(app).get('/colls/999999999'))).status).toBe(404);
    expect((await auth(request(app).get('/colls/999999999/products'))).status).toBe(404);
  });
});
