import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-cats-a-${suffix}@example.test`;
const emailB = `iso-cats-b-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let adminAId;
let adminBId;
let tokenA;
let tokenB;
let catAId;
let childOfAId;

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
    const a = await seedCompanyWithOwner(conn, { name: `Iso Cats Co A ${suffix}`, email: emailA, passHash });
    companyAId = a.companyId;
    adminAId = a.adminId;

    const b = await seedCompanyWithOwner(conn, { name: `Iso Cats Co B ${suffix}`, email: emailB, passHash });
    companyBId = b.companyId;
    adminBId = b.adminId;

    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  const parent = await request(app)
    .post('/cats')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ name: `A Private Cat ${suffix}` });
  catAId = parent.body.cat.id;

  const child = await request(app)
    .post('/cats')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ name: `A Private Child ${suffix}`, parentId: catAId });
  childOfAId = child.body.cat.id;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    const companies = { a: companyAId, b: companyBId };
    // Children first: cats_parent_fk is a self-reference.
    await conn.execute('DELETE FROM prod_cats WHERE company_id IN (:a, :b)', companies);
    await conn.execute('DELETE FROM cats WHERE company_id IN (:a, :b) AND parent_id IS NOT NULL', companies);
    await conn.execute('DELETE FROM cats WHERE company_id IN (:a, :b)', companies);
    await conn.execute('DELETE FROM logs WHERE company_id IN (:a, :b)', companies);
    await conn.execute('DELETE FROM admins WHERE id IN (:a, :b)', { a: adminAId, b: adminBId });
    await conn.execute('DELETE FROM companies WHERE id IN (:a, :b)', companies);
    await conn.commit();
  });

  await closeRedis();
  await closePool();
});

describe('cats: cross-company isolation (release gate)', () => {
  it('B reads A category by id -> 404', async () => {
    const res = await request(app).get(`/cats/${catAId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('B updates A category -> 404', async () => {
    const res = await request(app)
      .patch(`/cats/${catAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it('B deletes A category -> 404', async () => {
    const res = await request(app).delete(`/cats/${catAId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("B lists categories -> A's rows never appear", async () => {
    const res = await request(app).get('/cats').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((row) => row.id === catAId)).toBe(false);
  });

  it("B reads the tree -> A's rows never appear", async () => {
    const res = await request(app).get('/cats/tree').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children)]);
    expect(flatten(res.body.tree).some((node) => node.id === catAId)).toBe(false);
  });

  it("B reorders A's category -> 404 and A's tree is untouched", async () => {
    const res = await request(app)
      .post('/cats/reorder')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ items: [{ id: catAId, position: 77 }] });
    expect(res.status).toBe(404);

    const asA = await request(app).get(`/cats/${catAId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(asA.body.cat.position).toBe(0);
  });

  it("B cannot adopt A's category as its own parent", async () => {
    const own = await request(app)
      .post('/cats')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: `B Own Cat ${suffix}` });
    expect(own.status).toBe(201);

    const res = await request(app)
      .patch(`/cats/${own.body.cat.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ parentId: catAId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PARENT_NOT_FOUND');
  });

  it("B cannot create a category parented to A's category", async () => {
    const res = await request(app)
      .post('/cats')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: `B Grafted ${suffix}`, parentId: catAId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PARENT_NOT_FOUND');
  });

  it('B may reuse a slug A already uses (slugs are unique per company, not globally)', async () => {
    const res = await request(app)
      .post('/cats')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Shared Name', slug: `a-private-cat-${suffix}` });
    expect(res.status).toBe(201);
    expect(res.body.cat.slug).toBe(`a-private-cat-${suffix}`);
  });

  it('raw no-predicate SQL under B context cannot see A rows (proves VPD, not the repo WHERE)', async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute('SELECT id FROM cats WHERE id IN (:one, :two)', {
        one: catAId,
        two: childOfAId,
      });
      return result.rows;
    });
    expect(seenByB.length).toBe(0);

    const seenByA = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute('SELECT id FROM cats WHERE id IN (:one, :two)', {
        one: catAId,
        two: childOfAId,
      });
      return result.rows;
    });
    expect(seenByA.length).toBe(2);
  });

  it('A can still read and reorder its own tree', async () => {
    const res = await request(app)
      .post('/cats/reorder')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ items: [{ id: childOfAId, position: 3 }] });
    expect(res.status).toBe(200);

    const child = await request(app).get(`/cats/${childOfAId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(child.body.cat.position).toBe(3);
  });
});
