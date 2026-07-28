import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import sharp from 'sharp';
import request from 'supertest';
import { existsSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { variantPath } from '../../src/lib/mediaStorage.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `media-test-a-${suffix}@example.test`;
const hostA = `media-${suffix}.localhost`;

let companyAId;
let adminAId;
let tokenA;

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

  await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
    companyId,
    host: hostA,
  });

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
  });

  const app = createApp();
  const loginA = await request(app).post('/auth/login').send({ email: emailA, password });
  tokenA = loginA.body.accessToken;
});

afterAll(async () => {
  await getRedis().del(`sf:host:${hostA}`);
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM domains WHERE company_id = :a', { a: companyAId });
    await conn.execute('DELETE FROM media WHERE company_id = :a', { a: companyAId });
    await conn.execute('DELETE FROM logs WHERE admin_id = :a', { a: adminAId });
    await conn.execute('DELETE FROM admins WHERE id = :a', { a: adminAId });
    await conn.execute('DELETE FROM companies WHERE id = :a', { a: companyAId });
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

    // Both formats, every width: the serving side negotiates between them
    // from the browser's Accept header, so a missing AVIF variant would
    // silently mean nobody ever gets the smaller file.
    for (const width of [320, 640]) {
      expect(existsSync(variantPath(res.body.media.STORAGE_KEY, width, 'webp')), `webp ${width}`).toBe(true);
      expect(existsSync(variantPath(res.body.media.STORAGE_KEY, width, 'avif')), `avif ${width}`).toBe(true);
    }

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

  it('lets its own company read, update, and soft-delete what it uploaded', async () => {
    const app = createApp();
    const upload = await request(app)
      .post('/media')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', await makeTestImage(), 'own.png');
    const mediaId = upload.body.media.ID;

    const getRes = await request(app).get(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app)
      .patch(`/media/${mediaId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ alt: 'updated alt text' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.media.ALT).toBe('updated alt text');

    const deleteRes = await request(app).delete(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(deleteRes.status).toBe(204);

    const afterDelete = await request(app).get(`/media/${mediaId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(afterDelete.status).toBe(404);
  });
});

describe('public media serving negotiates AVIF against WebP', () => {
  let mediaId;
  let app;

  beforeAll(async () => {
    app = createApp();
    const image = await makeTestImage();
    const res = await request(app)
      .post('/media')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', image, 'negotiated.png');
    mediaId = res.body.media.ID;
  });

  const fetchImage = (accept) => {
    const req = request(app)
      .get(`/storefront/media/${mediaId}/file?width=320`)
      .set('X-Forwarded-Host', hostA);
    return accept ? req.set('Accept', accept) : req;
  };

  it('serves AVIF to a browser that accepts it', async () => {
    const res = await fetchImage('image/avif,image/webp,*/*');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/avif');
  });

  it('serves WebP to a browser that does not', async () => {
    const res = await fetchImage('image/webp,*/*');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/webp');
  });

  it('always says Vary: Accept, because both answers share one URL', async () => {
    // Without this header a shared cache in front of the API would serve an
    // AVIF body to a browser that cannot decode it — same URL, different
    // bytes.
    const res = await fetchImage('image/webp,*/*');
    expect(res.headers.vary).toContain('Accept');
  });
});
