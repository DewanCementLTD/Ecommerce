import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-auth-a-${suffix}@example.test`;
const emailB = `iso-auth-b-${suffix}@example.test`;

let companyAId;
let companyBId;
let adminAId;
let adminBId;
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
     VALUES (:companyId, :email, :passHash, 'Isolation Auth Admin', 'owner', 1)`,
    { companyId, email, passHash },
  );
  const admin = await conn.execute('SELECT id FROM admins WHERE email = :email', { email });

  await conn.execute('INSERT INTO settings (company_id, key, value) VALUES (:companyId, :key, :value)', {
    companyId,
    key: 'seo_title',
    value: name,
  });

  await conn.commit();
  return { companyId, adminId: admin.rows[0].ID };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const a = await seedAdmin(conn, { name: `Isolation Auth Co A ${suffix}`, email: emailA, passHash });
    companyAId = a.companyId;
    adminAId = a.adminId;

    const b = await seedAdmin(conn, { name: `Isolation Auth Co B ${suffix}`, email: emailB, passHash });
    companyBId = b.companyId;
    adminBId = b.adminId;
  });

  const app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM settings WHERE company_id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.execute('DELETE FROM logs WHERE admin_id IN (:a, :b)', { a: adminAId, b: adminBId });
    await conn.execute('DELETE FROM admins WHERE id IN (:a, :b)', { a: adminAId, b: adminBId });
    await conn.execute('DELETE FROM companies WHERE id IN (:a, :b)', { a: companyAId, b: companyBId });
    await conn.commit();
  });

  await closeRedis();
  await closePool();
});

describe('auth: a token is bound to its own company (release gate)', () => {
  it("a company token's company_id cannot be overridden by query, body, or header", async () => {
    const res = await request(createApp())
      .get(`/auth/me?company_id=${companyBId}&companyId=${companyBId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Company-Id', String(companyBId));

    expect(res.status).toBe(200);
    expect(res.body.admin.companyId).toBe(companyAId);
    expect(res.body.admin.companyId).not.toBe(companyBId);
  });

  it('a company admin token cannot reach platform-only routes', async () => {
    const app = createApp();

    for (const [method, path] of [
      ['get', '/platform/companies'],
      ['get', `/platform/companies/${companyBId}`],
      ['get', '/platform/logs'],
      ['post', `/platform/companies/${companyBId}/suspend`],
    ]) {
      const res = await request(app)[method](path).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
    }
  });

  it('an unauthenticated caller reaches nothing company-owned', async () => {
    const app = createApp();
    for (const path of ['/media', '/platform/companies', '/auth/me']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
    }
  });
});

describe('settings/admins tables: VPD blocks cross-company reads (release gate)', () => {
  it("company B's context cannot select company A's settings rows", async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute('SELECT id FROM settings WHERE company_id = :id', { id: companyAId });
      return result.rows;
    });
    expect(seenByB.length).toBe(0);

    const seenByA = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute('SELECT id FROM settings WHERE company_id = :id', { id: companyAId });
      return result.rows;
    });
    expect(seenByA.length).toBeGreaterThan(0);
  });

  it("company B's context cannot select company A's admins rows", async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute('SELECT id FROM admins WHERE id = :id', { id: adminAId });
      return result.rows;
    });
    expect(seenByB.length).toBe(0);
  });

  it("company B's context cannot UPDATE or DELETE company A's rows", async () => {
    const updated = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute(
        "UPDATE settings SET value = 'hijacked' WHERE company_id = :id",
        { id: companyAId },
      );
      await conn.commit();
      return result.rowsAffected;
    });
    expect(updated).toBe(0);

    const deleted = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute('DELETE FROM settings WHERE company_id = :id', { id: companyAId });
      await conn.commit();
      return result.rowsAffected;
    });
    expect(deleted).toBe(0);

    // A's row survived both attempts, unmodified.
    const stillThere = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute('SELECT value FROM settings WHERE company_id = :id', {
        id: companyAId,
      });
      return result.rows;
    });
    expect(stillThere.length).toBeGreaterThan(0);
    expect(stillThere[0].VALUE).not.toBe('hijacked');
  });

  it("company B's context cannot INSERT a row belonging to company A (update_check)", async () => {
    await expect(
      withCompany(companyBId, async (conn) => {
        await conn.execute(
          'INSERT INTO settings (company_id, key, value) VALUES (:companyId, :key, :value)',
          { companyId: companyAId, key: `smuggled_${suffix}`, value: 'x' },
        );
        await conn.commit();
      }),
    ).rejects.toThrow(/ORA-28115/);
  });
});
