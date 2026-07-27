import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-content-a-${suffix}@example.test`;
const emailB = `iso-content-b-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let tokenA;
let tokenB;
let pageAId;
let sectionAId;
let bannerAId;
let menuAId;
let menuItemAId;

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
      await conn.execute(
        `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
         VALUES (:companyId, :email, :passHash, 'Iso Owner', 'owner', 1)`,
        { companyId, email, passHash },
      );
      await conn.execute(
        `INSERT INTO pages (company_id, title, slug, type) VALUES (:companyId, 'Home', 'home', 'home')`,
        { companyId },
      );
      await conn.execute(`INSERT INTO menus (company_id, code, name) VALUES (:companyId, 'header', 'Header')`, {
        companyId,
      });
      return companyId;
    };

    companyAId = await seed(`Iso Content A ${suffix}`, emailA);
    companyBId = await seed(`Iso Content B ${suffix}`, emailB);
    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  pageAId = (await asA(request(app).get('/pages'))).body.rows.find((row) => row.type === 'home').id;
  sectionAId = (await asA(request(app).post(`/pages/${pageAId}/sections`)).send({ type: 'hero' })).body
    .rows[0].id;
  bannerAId = (await asA(request(app).post('/banners')).send({ name: `A Banner ${suffix}` })).body.banner.id;
  menuAId = (await asA(request(app).get('/menus'))).body.rows[0].id;
  menuItemAId = (
    await asA(request(app).post(`/menus/${menuAId}/items`)).send({
      label: 'A Link',
      linkType: 'url',
      url: '/a',
    })
  ).body.items[0].id;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyAId, companyBId]);
  });
  await closeRedis();
  await closePool();
});

describe('content: cross-company isolation (release gate)', () => {
  it("B reads A's page -> 404", async () => {
    expect((await asB(request(app).get(`/pages/${pageAId}`))).status).toBe(404);
  });

  it("B lists pages -> only its own home page", async () => {
    const res = await asB(request(app).get('/pages'));
    expect(res.body.rows.map((row) => row.id)).not.toContain(pageAId);
    expect(res.body.rows).toHaveLength(1);
  });

  it("B edits or deletes A's page -> 404", async () => {
    expect((await asB(request(app).patch(`/pages/${pageAId}`)).send({ title: 'hijacked' })).status).toBe(404);
    expect((await asB(request(app).delete(`/pages/${pageAId}`))).status).toBe(404);
  });

  it("B reads A's sections -> 404", async () => {
    expect((await asB(request(app).get(`/pages/${pageAId}/sections`))).status).toBe(404);
  });

  it("B toggles A's section -> 404 and it stays on", async () => {
    const res = await asB(request(app).patch(`/sections/${sectionAId}`)).send({ isActive: false });
    expect(res.status).toBe(404);

    const asOwner = await asA(request(app).get(`/pages/${pageAId}/sections`));
    expect(asOwner.body.rows.find((row) => row.id === sectionAId).isActive).toBe(1);
  });

  it("B deletes A's section -> 404", async () => {
    expect((await asB(request(app).delete(`/sections/${sectionAId}`))).status).toBe(404);
  });

  it("B reorders A's section onto its own page -> 404", async () => {
    const ownPage = (await asB(request(app).get('/pages'))).body.rows[0];
    const res = await asB(request(app).post(`/pages/${ownPage.id}/sections/reorder`)).send({
      items: [{ id: sectionAId, position: 0 }],
    });
    expect(res.status).toBe(404);
  });

  it("B cannot add a section to A's page", async () => {
    const res = await asB(request(app).post(`/pages/${pageAId}/sections`)).send({ type: 'rich' });
    expect(res.status).toBe(404);
  });

  it("B reads, edits or deletes A's banner -> 404", async () => {
    expect((await asB(request(app).get(`/banners/${bannerAId}`))).status).toBe(404);
    expect((await asB(request(app).patch(`/banners/${bannerAId}`)).send({ name: 'x' })).status).toBe(404);
    expect((await asB(request(app).delete(`/banners/${bannerAId}`))).status).toBe(404);
    expect((await asB(request(app).get('/banners'))).body.rows).toHaveLength(0);
  });

  it("B cannot read or add items to A's menu", async () => {
    expect((await asB(request(app).get(`/menus/${menuAId}/items`))).status).toBe(404);
    const res = await asB(request(app).post(`/menus/${menuAId}/items`)).send({
      label: 'Injected',
      linkType: 'url',
      url: '/x',
    });
    expect(res.status).toBe(404);
  });

  it("B cannot edit or delete A's menu item", async () => {
    expect((await asB(request(app).patch(`/menu-items/${menuItemAId}`)).send({ label: 'x' })).status).toBe(404);
    expect((await asB(request(app).delete(`/menu-items/${menuItemAId}`))).status).toBe(404);
  });

  it("B cannot nest its own menu item under A's", async () => {
    const ownMenu = (await asB(request(app).get('/menus'))).body.rows[0];
    const own = await asB(request(app).post(`/menus/${ownMenu.id}/items`)).send({
      label: 'B Link',
      linkType: 'url',
      url: '/b',
    });
    const res = await asB(request(app).patch(`/menu-items/${own.body.items[0].id}`)).send({
      parentId: menuItemAId,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PARENT_NOT_FOUND');
  });

  it('raw no-predicate SQL under B context reaches none of A content rows (proves VPD)', async () => {
    const checks = [
      ['pages', pageAId],
      ['sections', sectionAId],
      ['banners', bannerAId],
      ['menus', menuAId],
      ['menu_items', menuItemAId],
    ];

    for (const [table, id] of checks) {
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

  it('both stores can hold a home page at the same slug', async () => {
    const rows = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `SELECT company_id FROM pages WHERE slug = 'home' AND company_id IN (:a, :b)`,
        { a: companyAId, b: companyBId },
      );
      return result.rows;
    });
    expect(rows).toHaveLength(2);
  });
});
