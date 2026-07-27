import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-coll-a-${suffix}@example.test`;
const emailB = `iso-coll-b-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let adminAId;
let adminBId;
let tokenA;
let tokenB;
let collAId;
let productAId;

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);
const asB = (req) => req.set('Authorization', `Bearer ${tokenB}`);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const seed = async (name, email) => {
      const companyId = (
        await conn.execute(
          `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
          { name, id: OUT_ID },
        )
      ).outBinds.id[0];
      const adminId = (
        await conn.execute(
          `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
           VALUES (:companyId, :email, :passHash, 'Iso Owner', 'owner', 1) RETURNING id INTO :id`,
          { companyId, email, passHash, id: OUT_ID },
        )
      ).outBinds.id[0];
      return { companyId, adminId };
    };

    ({ companyId: companyAId, adminId: adminAId } = await seed(`Iso Coll A ${suffix}`, emailA));
    ({ companyId: companyBId, adminId: adminBId } = await seed(`Iso Coll B ${suffix}`, emailB));
    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  productAId = (
    await asA(request(app).post('/products')).send({
      name: `A Secret Product ${suffix}`,
      brand: 'SharedBrand',
      tags: ['shared'],
      variants: [{ price: 50 }],
    })
  ).body.product.id;

  collAId = (
    await asA(request(app).post('/colls')).send({
      name: `A Secret Coll ${suffix}`,
      productIds: [productAId],
    })
  ).body.coll.id;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    const companies = { a: companyAId, b: companyBId };
    for (const sql of [
      'DELETE FROM coll_prods WHERE company_id IN (:a, :b)',
      'DELETE FROM colls WHERE company_id IN (:a, :b)',
      'DELETE FROM variants WHERE company_id IN (:a, :b)',
      'DELETE FROM products WHERE company_id IN (:a, :b)',
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

describe('colls: cross-company isolation (release gate)', () => {
  it("B reads A's collection -> 404", async () => {
    expect((await asB(request(app).get(`/colls/${collAId}`))).status).toBe(404);
  });

  it("B updates A's collection -> 404", async () => {
    const res = await asB(request(app).patch(`/colls/${collAId}`)).send({ name: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it("B deletes A's collection -> 404 and it survives", async () => {
    expect((await asB(request(app).delete(`/colls/${collAId}`))).status).toBe(404);
    expect((await asA(request(app).get(`/colls/${collAId}`))).status).toBe(200);
  });

  it("B lists collections -> A's never appear", async () => {
    const res = await asB(request(app).get('/colls?pageSize=100'));
    expect(res.body.rows.some((row) => row.id === collAId)).toBe(false);
    expect(res.body.total).toBe(0);
  });

  it("B reads A's collection members -> 404", async () => {
    expect((await asB(request(app).get(`/colls/${collAId}/products`))).status).toBe(404);
  });

  it("B cannot add A's product to its own collection", async () => {
    const own = await asB(request(app).post('/colls')).send({ name: `B Coll ${suffix}` });
    const res = await asB(request(app).put(`/colls/${own.body.coll.id}/products`)).send({
      productIds: [productAId],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it("an automatic rule in B's store never matches A's products", async () => {
    // Same brand and tag as company A's product: only the tenant boundary
    // separates them, and the rule query carries no company predicate of its own
    // beyond the one every listing has.
    const coll = await asB(request(app).post('/colls')).send({
      name: `B Auto ${suffix}`,
      type: 'auto',
      rules: {
        match: 'any',
        conditions: [
          { field: 'brand', op: 'eq', value: 'SharedBrand' },
          { field: 'tag', op: 'eq', value: 'shared' },
        ],
      },
    });
    expect(coll.status).toBe(201);

    const members = await asB(request(app).get(`/colls/${coll.body.coll.id}/products`));
    expect(members.status).toBe(200);
    expect(members.body.total).toBe(0);
  });

  it('raw no-predicate SQL under B context reaches neither colls nor coll_prods of A', async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const colls = await conn.execute('SELECT id FROM colls WHERE id = :id', { id: collAId });
      const links = await conn.execute('SELECT product_id FROM coll_prods WHERE coll_id = :id', {
        id: collAId,
      });
      return colls.rows.length + links.rows.length;
    });
    expect(seenByB).toBe(0);

    const seenByA = await withCompany(companyAId, async (conn) => {
      const colls = await conn.execute('SELECT id FROM colls WHERE id = :id', { id: collAId });
      const links = await conn.execute('SELECT product_id FROM coll_prods WHERE coll_id = :id', {
        id: collAId,
      });
      return colls.rows.length + links.rows.length;
    });
    expect(seenByA).toBe(2);
  });

  it('A still sees its own collection intact', async () => {
    const members = await asA(request(app).get(`/colls/${collAId}/products`));
    expect(members.body.rows.map((row) => row.id)).toEqual([productAId]);
  });
});
