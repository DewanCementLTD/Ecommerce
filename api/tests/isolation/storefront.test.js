import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import oracledb from 'oracledb';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { getRedis, closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const hostA = `iso-storefront-a-${suffix}.example.test`;
const hostB = `iso-storefront-b-${suffix}.example.test`;

let companyAId;
let companyBId;
let mediaAId;

async function seedCompany(conn, name, host) {
  await conn.execute('INSERT INTO companies (name, status) VALUES (:name, :status)', {
    name,
    status: 'active',
  });
  const company = await conn.execute('SELECT id FROM companies WHERE name = :name', { name });
  const id = company.rows[0].ID;
  await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:id, :host, 1)', {
    id,
    host,
  });
  return id;
}

beforeAll(async () => {
  await initPool();

  await withPlatform(async (conn) => {
    companyAId = await seedCompany(conn, `Isolation Storefront Co A ${suffix}`, hostA);
    companyBId = await seedCompany(conn, `Isolation Storefront Co B ${suffix}`, hostB);

    const image = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .webp()
      .toBuffer();
    const { writeVariant } = await import('../../src/lib/mediaStorage.js');
    const storageKey = `${companyAId}/iso-test-${suffix}`;
    await writeVariant(storageKey, 320, image);

    const result = await conn.execute(
      `INSERT INTO media (company_id, filename, alt, mime, size_bytes, width, height, storage_key)
       VALUES (:companyId, 'logo.webp', NULL, 'image/webp', :sizeBytes, 200, 200, :storageKey)
       RETURNING id INTO :id`,
      {
        companyId: companyAId,
        sizeBytes: image.length,
        storageKey,
        id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
      },
    );
    mediaAId = result.outBinds.id[0];

    await conn.commit();
  });
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM media WHERE company_id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.execute('DELETE FROM domains WHERE company_id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.execute('DELETE FROM companies WHERE id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.commit();
  });

  await getRedis().del(`sf:host:${hostA}`, `sf:host:${hostB}`);
  await closeRedis();
  await closePool();
});

describe('storefront public media route: cross-tenant isolation (release gate)', () => {
  it("host B cannot fetch host A's media file by id, even unauthenticated", async () => {
    const res = await request(createApp()).get(`/storefront/media/${mediaAId}/file`).set('Host', hostB);
    expect(res.status).toBe(404);
  });

  it("host A can fetch its own media file", async () => {
    const res = await request(createApp()).get(`/storefront/media/${mediaAId}/file`).set('Host', hostA);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
  });
});
