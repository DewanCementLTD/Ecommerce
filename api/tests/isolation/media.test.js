import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-media-a-${suffix}@example.test`;
const emailB = `iso-media-b-${suffix}@example.test`;

let companyAId;
let companyBId;
let adminAId;
let adminBId;
let tokenA;
let tokenB;
let mediaId;

async function seedAdmin(conn, { name, email, passHash }) {
  await conn.execute('INSERT INTO companies (name, status) VALUES (:name, :status)', {
    name,
    status: 'active',
  });
  const company = await conn.execute('SELECT id FROM companies WHERE name = :name', { name });
  const companyId = company.rows[0].ID;

  await conn.execute(
    `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
     VALUES (:companyId, :email, :passHash, 'Isolation Test Admin', 'owner', 1)`,
    { companyId, email, passHash },
  );
  const admin = await conn.execute('SELECT id FROM admins WHERE email = :email', { email });

  await conn.commit();
  return { companyId, adminId: admin.rows[0].ID };
}

async function makeTestImage() {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .png()
    .toBuffer();
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const a = await seedAdmin(conn, { name: `Isolation Media Co A ${suffix}`, email: emailA, passHash });
    companyAId = a.companyId;
    adminAId = a.adminId;

    const b = await seedAdmin(conn, { name: `Isolation Media Co B ${suffix}`, email: emailB, passHash });
    companyBId = b.companyId;
    adminBId = b.adminId;
  });

  const app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  const upload = await request(app)
    .post('/media')
    .set('Authorization', `Bearer ${tokenA}`)
    .attach('file', await makeTestImage(), 'a-private.png');
  mediaId = upload.body.media.ID;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM media WHERE company_id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.execute('DELETE FROM logs WHERE admin_id IN (:a, :b)', { a: adminAId, b: adminBId });
    await conn.execute('DELETE FROM admins WHERE id IN (:a, :b)', { a: adminAId, b: adminBId });
    await conn.execute('DELETE FROM companies WHERE id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.commit();
  });

  await closeRedis();
  await closePool();
});

describe('media: cross-company isolation (release gate)', () => {
  it('B reads A resource by id -> 404', async () => {
    const res = await request(createApp()).get(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('B updates A resource -> 404', async () => {
    const res = await request(createApp())
      .patch(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ alt: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it('B deletes A resource -> 404', async () => {
    const res = await request(createApp())
      .delete(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("B lists resources -> A's rows never appear", async () => {
    const res = await request(createApp()).get('/media').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((row) => row.ID === mediaId)).toBe(false);
  });

  it('B fetches the file bytes for A resource -> 404', async () => {
    const res = await request(createApp())
      .get(`/media/${mediaId}/file`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('direct repo call under company B context cannot select company A rows (proves VPD, not just app code)', async () => {
    // No company_id predicate in this SQL at all — if this returns 0 rows, only
    // Oracle's VPD policy (not the repo layer's own WHERE clause) is responsible.
    const rowsSeenByB = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute('SELECT id FROM media WHERE id = :id', { id: mediaId });
      return result.rows;
    });
    expect(rowsSeenByB.length).toBe(0);

    const rowsSeenByA = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute('SELECT id FROM media WHERE id = :id', { id: mediaId });
      return result.rows;
    });
    expect(rowsSeenByA.length).toBe(1);
  });

  it('A can still read its own resource (isolation is not fail-open in the other direction)', async () => {
    const res = await request(createApp()).get(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
  });
});
