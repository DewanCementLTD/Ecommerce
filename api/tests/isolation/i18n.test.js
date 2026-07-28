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
const emailA = `iso-i18n-a-${suffix}@example.test`;
const emailB = `iso-i18n-b-${suffix}@example.test`;
const hostB = `iso-i18n-b-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let tokenA;
let tokenB;
let productAId;
let productBId;
let productBSlug;

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);
const asB = (req) => req.set('Authorization', `Bearer ${tokenB}`);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const seed = async (name, email, host) => {
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
        `INSERT INTO langs (company_id, code, name, is_default, is_active)
         VALUES (:companyId, 'en', 'English', 1, 1)`,
        { companyId },
      );
      if (host) {
        await conn.execute(
          'INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)',
          { companyId, host },
        );
      }
      return companyId;
    };

    companyAId = await seed(`Iso I18n A ${suffix}`, emailA, null);
    companyBId = await seed(`Iso I18n B ${suffix}`, emailB, hostB);
    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  // Both stores enable Arabic and translate a product of their own.
  await asA(request(app).post('/langs')).send({ code: 'ar', name: 'Arabic A' });
  await asB(request(app).post('/langs')).send({ code: 'ar', name: 'Arabic B' });

  productAId = (
    await asA(request(app).post('/products')).send({ name: 'A Product', variants: [{ price: 1 }] })
  ).body.product.id;

  const productB = (
    await asB(request(app).post('/products')).send({ name: 'B Product', variants: [{ price: 1 }] })
  ).body.product;
  productBId = productB.id;
  productBSlug = productB.slug;

  await asA(request(app).put(`/trans/product/${productAId}`)).send({
    lang: 'ar',
    fields: { name: 'منتج أ السري' },
  });
  await asB(request(app).put(`/trans/product/${productBId}`)).send({
    lang: 'ar',
    fields: { name: 'منتج ب' },
  });
});

afterAll(async () => {
  await getRedis().del(`sf:host:${hostB}`);
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM trans WHERE company_id IN (:a, :b)', { a: companyAId, b: companyBId });
    await deleteCompanies(conn, [companyAId, companyBId]);
  });
  await closeRedis();
  await closePool();
});

describe('i18n: cross-company isolation (release gate)', () => {
  it("B cannot read A's translations", async () => {
    const res = await asB(request(app).get(`/trans/product/${productAId}`));
    expect(res.status).toBe(200);
    // The row is invisible to B, so there is simply nothing stored for that id.
    expect(res.body.translations).toEqual({});
  });

  it("B writing a translation for A's product id creates a row in B's own store, not A's", async () => {
    const res = await asB(request(app).put(`/trans/product/${productAId}`)).send({
      lang: 'ar',
      fields: { name: 'HIJACKED' },
    });
    expect(res.status).toBe(200);

    // A's own translation is untouched...
    const asOwner = await asA(request(app).get(`/trans/product/${productAId}`));
    expect(asOwner.body.translations.ar.name).toBe('منتج أ السري');

    // ...and the row B wrote is stamped with B's company_id, so it can never be
    // read by A, nor rendered on A's storefront.
    const rows = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `SELECT company_id, value FROM trans
          WHERE entity = 'product' AND entity_id = :id AND lang = 'ar' ORDER BY company_id`,
        { id: productAId },
      );
      return result.rows;
    });
    expect(rows.map((row) => row.COMPANY_ID).sort()).toEqual([companyAId, companyBId].sort());
    expect(rows.find((row) => row.COMPANY_ID === companyAId).VALUE).toBe('منتج أ السري');

    const seenByA = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute(
        `SELECT value FROM trans WHERE entity_id = :id AND lang = 'ar'`,
        { id: productAId },
      );
      return result.rows.map((row) => row.VALUE);
    });
    expect(seenByA).toEqual(['منتج أ السري']);
  });

  it("B's storefront never renders A's translation", async () => {
    const res = await request(app)
      .get(`/shop/products/${productBSlug}?lang=ar`)
      .set('X-Forwarded-Host', hostB);
    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('منتج ب');
  });

  it("B cannot delete A's language", async () => {
    const langsOfA = (await asA(request(app).get('/langs'))).body.rows;
    const arabicOfA = langsOfA.find((row) => row.code === 'ar');

    const res = await asB(request(app).delete(`/langs/${arabicOfA.id}`));
    expect(res.status).toBe(404);

    const stillThere = (await asA(request(app).get('/langs'))).body.rows.map((row) => row.code);
    expect(stillThere).toContain('ar');
  });

  it("B's language list contains only its own languages", async () => {
    const res = await asB(request(app).get('/langs'));
    expect(res.body.rows.map((row) => row.name).sort()).toEqual(['Arabic B', 'English']);
  });

  it('raw no-predicate SQL under B context cannot see A trans rows (proves VPD)', async () => {
    // DBMS_LOB.SUBSTR because Oracle refuses to compare a CLOB with = (ORA-00932).
    const findValue = (companyId) =>
      withCompany(companyId, async (conn) => {
        const result = await conn.execute(
          `SELECT company_id FROM trans
            WHERE entity = 'product' AND entity_id = :id
              AND DBMS_LOB.SUBSTR(value, 200, 1) = :value`,
          { id: productAId, value: 'منتج أ السري' },
        );
        return result.rows;
      });

    expect(await findValue(companyBId)).toHaveLength(0);
    expect(await findValue(companyAId)).toHaveLength(1);
  });
});
