import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';
import { variantPath } from '../../src/lib/mediaStorage.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `media-test-a-${suffix}@example.test`;
const emailB = `media-test-b-${suffix}@example.test`;

let companyAId;
let companyBId;
let adminAId;
let adminBId;
let tokenA;
let tokenB;

async function seedAdmin(conn, { name, email, passHash }) {
  await conn.execute('INSERT INTO companies (name, status) VALUES (:name, :status)', {
    name,
    status: 'active',
  });
  const company = await conn.execute('SELECT id FROM companies WHERE name = :name', { name });
  const companyId = company.rows[0].ID;

  await conn.execute(
    `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
     VALUES (:companyId, :email, :passHash, 'Media Test Admin', 'owner', 1)`,
    { companyId, email, passHash },
  );
  const admin = await conn.execute('SELECT id FROM admins WHERE email = :email', { email });

  await conn.commit();
  return { companyId, adminId: admin.rows[0].ID };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const a = await seedAdmin(conn, { name: `Media Test Co A ${suffix}`, email: emailA, passHash });
    companyAId = a.companyId;
    adminAId = a.adminId;

    const b = await seedAdmin(conn, { name: `Media Test Co B ${suffix}`, email: emailB, passHash });
    companyBId = b.companyId;
    adminBId = b.adminId;
  });

  const app = createApp();
  const loginA = await request(app).post('/auth/login').send({ email: emailA, password });
  tokenA = loginA.body.accessToken;
  const loginB = await request(app).post('/auth/login').send({ email: emailB, password });
  tokenB = loginB.body.accessToken;
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

async function makeTestImage() {
  return sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
}

describe('media upload', () => {
  it('uploads an image, generates thumbnails, and rejects non-images', async () => {
    const app = createApp();
    const image = await makeTestImage();

    const res = await request(app)
      .post('/media')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('alt', 'a test image')
      .field('folder', 'products')
      .attach('file', image, 'photo.png');

    expect(res.status).toBe(201);
    expect(res.body.media.MIME).toBe('image/webp');
    expect(res.body.media.WIDTH).toBe(800);
    expect(res.body.media.FOLDER).toBe('products');

    expect(existsSync(variantPath(res.body.media.STORAGE_KEY, 320))).toBe(true);
    expect(existsSync(variantPath(res.body.media.STORAGE_KEY, 640))).toBe(true);

    const notAnImage = await request(app)
      .post('/media')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('this is not an image'), 'fake.png');
    expect(notAnImage.status).toBe(400);
    expect(notAnImage.body.error.code).toBe('INVALID_FILE_TYPE');
  });

  it('requires authentication', async () => {
    const image = await makeTestImage();
    const res = await request(createApp()).post('/media').attach('file', image, 'photo.png');
    expect(res.status).toBe(401);
  });
});

describe('cross-company isolation', () => {
  let mediaId;

  beforeAll(async () => {
    const image = await makeTestImage();
    const res = await request(createApp())
      .post('/media')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', image, 'private.png');
    mediaId = res.body.media.ID;
  });

  it('Company B cannot read Company A media by id', async () => {
    const res = await request(createApp())
      .get(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it("Company B cannot see Company A media in its own list", async () => {
    const res = await request(createApp()).get('/media').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((row) => row.ID === mediaId)).toBe(false);
  });

  it('Company B cannot fetch the file bytes for Company A media', async () => {
    const res = await request(createApp())
      .get(`/media/${mediaId}/file`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  it('Company B cannot update or delete Company A media', async () => {
    const patchRes = await request(createApp())
      .patch(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ alt: 'hijacked' });
    expect(patchRes.status).toBe(404);

    const deleteRes = await request(createApp())
      .delete(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(deleteRes.status).toBe(404);
  });

  it('Company A can read, update, and soft-delete its own media', async () => {
    const app = createApp();
    const getRes = await request(app).get(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app)
      .patch(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ alt: 'updated alt text' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.media.ALT).toBe('updated alt text');

    const deleteRes = await request(app)
      .delete(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(deleteRes.status).toBe(204);

    const afterDelete = await request(app).get(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(afterDelete.status).toBe(404);
  });
});
