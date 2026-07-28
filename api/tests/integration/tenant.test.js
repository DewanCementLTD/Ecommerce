import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { getRedis, closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const hostA = `tenant-test-a-${suffix}.example.test`;
const hostB = `tenant-test-b-${suffix}.example.test`;
const hostSuspended = `tenant-test-suspended-${suffix}.example.test`;
const hostUnknown = `tenant-test-unknown-${suffix}.example.test`;

let companyAId;
let companyBId;
let companySuspendedId;

async function seedCompany(conn, name, status, host) {
  await conn.execute('INSERT INTO companies (name, status) VALUES (:name, :status)', { name, status });
  const result = await conn.execute('SELECT id FROM companies WHERE name = :name', { name });
  const id = result.rows[0].ID;
  await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:id, :host, 1)', {
    id,
    host,
  });
  await conn.commit();
  return id;
}

beforeAll(async () => {
  await initPool();

  await withPlatform(async (conn) => {
    companyAId = await seedCompany(conn, `Tenant Test Co A ${suffix}`, 'active', hostA);
    companyBId = await seedCompany(conn, `Tenant Test Co B ${suffix}`, 'active', hostB);
    companySuspendedId = await seedCompany(
      conn,
      `Tenant Test Co Suspended ${suffix}`,
      'suspended',
      hostSuspended,
    );
  });
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const id of [companyAId, companyBId, companySuspendedId]) {
      await conn.execute('DELETE FROM domains WHERE company_id = :id', { id });
      await conn.execute('DELETE FROM companies WHERE id = :id', { id });
    }
    await conn.commit();
  });

  const redis = getRedis();
  await redis.del(`sf:host:${hostA}`, `sf:host:${hostB}`, `sf:host:${hostSuspended}`, `sf:host:${hostUnknown}`);

  await closeRedis();
  await closePool();
});

describe('tenant resolver', () => {
  it('resolves two different hosts to two different companies', async () => {
    const resA = await request(createApp()).get('/storefront/company').set('Host', hostA);
    expect(resA.status).toBe(200);
    expect(resA.body.company.id).toBe(companyAId);

    const resB = await request(createApp()).get('/storefront/company').set('Host', hostB);
    expect(resB.status).toBe(200);
    expect(resB.body.company.id).toBe(companyBId);
    expect(resB.body.company.id).not.toBe(resA.body.company.id);
  });

  it('404s for an unknown host', async () => {
    const res = await request(createApp()).get('/storefront/company').set('Host', hostUnknown);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SITE_NOT_FOUND');
  });

  it('returns a 503 maintenance response for a suspended company', async () => {
    const res = await request(createApp()).get('/storefront/company').set('Host', hostSuspended);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('prefers X-Forwarded-Host over Host, and strips port and www.', async () => {
    const res = await request(createApp())
      .get('/storefront/company')
      .set('Host', 'ignored-host:9999')
      .set('X-Forwarded-Host', `www.${hostA}:8080`);
    expect(res.status).toBe(200);
    expect(res.body.company.id).toBe(companyAId);
  });
});
