import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';

/**
 * Privilege escalation, tested explicitly — Phase 3, Task 3.
 *
 * The phase brief names three things a company admin must not be able to do,
 * and asks for a test for each rather than a claim:
 *
 *   1. escalate themselves (or anyone) to the `platform` role,
 *   2. read another company's anything,
 *   3. set their own `company_id`.
 *
 * Every one of these is attempted here as a real HTTP request with a real
 * token, against a second company that really exists — the failure mode being
 * guarded against is an endpoint that takes a field from the request body and
 * trusts it, which only shows up when something actually sends that field.
 */

const suffix = Date.now();
const password = 'correct horse battery staple';
const hostA = `esc-a-${suffix}.localhost`;
const hostB = `esc-b-${suffix}.localhost`;
const ownerA = `esc-owner-a-${suffix}@example.test`;
const ownerB = `esc-owner-b-${suffix}@example.test`;
const platformEmail = `esc-platform-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let tokenA;
let tokenB;
let platformToken;
let adminAId;
let adminBId;
let platformAdminId;
let productBId;

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);

async function seedCompany(conn, { name, host, email, passHash }) {
  const companyId = (
    await conn.execute(
      `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
      { name, id: OUT_ID },
    )
  ).outBinds.id[0];

  await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
    companyId,
    host,
  });

  const adminId = (
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Owner', 'owner', 1) RETURNING id INTO :id`,
      { companyId, email, passHash, id: OUT_ID },
    )
  ).outBinds.id[0];

  return { companyId, adminId };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    ({ companyId: companyAId, adminId: adminAId } = await seedCompany(conn, {
      name: `Escalation A ${suffix}`,
      host: hostA,
      email: ownerA,
      passHash,
    }));
    ({ companyId: companyBId, adminId: adminBId } = await seedCompany(conn, {
      name: `Escalation B ${suffix}`,
      host: hostB,
      email: ownerB,
      passHash,
    }));

    platformAdminId = (
      await conn.execute(
        `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
         VALUES (NULL, :email, :passHash, 'Platform', 'platform', 1) RETURNING id INTO :id`,
        { email: platformEmail, passHash, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: ownerA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: ownerB, password })).body.accessToken;
  platformToken = (await request(app).post('/auth/login').send({ email: platformEmail, password })).body
    .accessToken;

  productBId = (
    await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: `B only ${suffix}`, variants: [{ price: 5 }] })
  ).body.product.id;
});

afterAll(async () => {
  await getRedis().del(`sf:host:${hostA}`, `sf:host:${hostB}`);
  await withPlatform(async (conn) => {
    const both = { a: companyAId, b: companyBId };
    for (const sql of [
      'DELETE FROM variants WHERE company_id IN (:a, :b)',
      'DELETE FROM products WHERE company_id IN (:a, :b)',
      'DELETE FROM settings WHERE company_id IN (:a, :b)',
      'DELETE FROM logs WHERE company_id IN (:a, :b)',
      'DELETE FROM domains WHERE company_id IN (:a, :b)',
    ]) {
      await conn.execute(sql, both);
    }
    await conn.execute('DELETE FROM logs WHERE admin_id = :id', { id: platformAdminId });
    await conn.execute('DELETE FROM admins WHERE company_id IN (:a, :b)', both);
    await conn.execute('DELETE FROM admins WHERE id = :id', { id: platformAdminId });
    await conn.execute('DELETE FROM companies WHERE id IN (:a, :b)', both);
    await conn.commit();
  });
  await closeRedis();
  await closePool();
});

describe('a company admin cannot escalate to the platform role', () => {
  it('cannot create a staff member with role=platform', async () => {
    const res = await asA(request(app).post('/admins')).send({
      email: `sneaky-${suffix}@example.test`,
      name: 'Sneaky',
      password,
      role: 'platform',
    });

    // Either the schema refuses the value outright or the service ignores it.
    // What must never happen is a platform-role row appearing.
    if (res.status < 400) {
      expect(res.body.admin.role).not.toBe('platform');
    } else {
      expect(res.status).toBe(400);
    }

    const platformRows = await withPlatform((conn) =>
      conn
        .execute(`SELECT COUNT(*) AS n FROM admins WHERE role = 'platform' AND company_id = :companyId`, {
          companyId: companyAId,
        })
        .then((result) => result.rows[0].N),
    );
    expect(platformRows).toBe(0);
  });

  it('cannot promote themselves by patching their own staff record', async () => {
    const res = await asA(request(app).patch(`/admins/${adminAId}`)).send({ role: 'platform' });

    if (res.status < 400) {
      expect(res.body.admin.role).not.toBe('platform');
    }

    const role = await withPlatform((conn) =>
      conn
        .execute('SELECT role FROM admins WHERE id = :id', { id: adminAId })
        .then((result) => result.rows[0].ROLE),
    );
    expect(role).not.toBe('platform');
  });

  it('is refused by every /platform route even with a valid token', async () => {
    for (const [method, path] of [
      ['get', '/platform/companies'],
      ['get', '/platform/logs'],
      ['post', '/platform/companies'],
      ['get', `/platform/companies/${companyBId}`],
      ['post', `/platform/companies/${companyBId}/impersonate`],
      ['post', `/platform/companies/${companyBId}/suspend`],
    ]) {
      const res = await asA(request(app)[method](path)).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });
});

describe('a company admin cannot choose which company they act as', () => {
  it('ignores a company_id in the request body when creating a product', async () => {
    const res = await asA(request(app).post('/products')).send({
      name: `Planted in B ${suffix}`,
      companyId: companyBId,
      company_id: companyBId,
      variants: [{ price: 9 }],
    });
    expect(res.status).toBe(201);

    const owner = await withPlatform((conn) =>
      conn
        .execute('SELECT company_id FROM products WHERE id = :id', { id: res.body.product.id })
        .then((result) => result.rows[0].COMPANY_ID),
    );
    expect(owner).toBe(companyAId);
  });

  it('ignores a company_id in the body when saving settings', async () => {
    await asA(request(app).put('/settings')).send({
      companyId: companyBId,
      values: { seo_title: `Written by A ${suffix}` },
    });

    const rows = await withPlatform((conn) =>
      conn
        .execute(`SELECT company_id FROM settings WHERE TO_CHAR(value) = :value`, {
          value: `Written by A ${suffix}`,
        })
        .then((result) => result.rows),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].COMPANY_ID).toBe(companyAId);
  });

  it('cannot mint a token for another company by asking for one', async () => {
    // Impersonation is the only route that issues a token carrying a company
    // the caller did not log in as, and it is platform-only.
    const res = await asA(request(app).post(`/platform/companies/${companyBId}/impersonate`)).send({});
    expect(res.status).toBe(403);
  });
});

describe("a company admin cannot read another company's anything", () => {
  it("404s on B's product by id", async () => {
    const res = await asA(request(app).get(`/products/${productBId}`));
    expect(res.status).toBe(404);
  });

  it("404s on B's staff record, and cannot deactivate it", async () => {
    expect((await asA(request(app).get(`/admins/${adminBId}`))).status).toBe(404);
    const patched = await asA(request(app).patch(`/admins/${adminBId}`)).send({ isActive: 0 });
    expect(patched.status).toBe(404);

    const stillActive = await withPlatform((conn) =>
      conn
        .execute('SELECT is_active FROM admins WHERE id = :id', { id: adminBId })
        .then((result) => result.rows[0].IS_ACTIVE),
    );
    expect(stillActive).toBe(1);
  });

  it("cannot read B's settings, orders, customers or dashboard", async () => {
    const a = await asA(request(app).get('/settings'));
    expect(a.body.settings?.seo_title ?? '').not.toContain('Escalation B');

    for (const path of ['/orders', '/customers', '/dashboard/summary']) {
      const res = await asA(request(app).get(path));
      expect(res.status, path).toBe(200);
      // Every one of these is company-scoped by the token, so the only proof
      // that matters is that B's ids are absent.
      expect(JSON.stringify(res.body)).not.toContain(`"${productBId}"`);
    }
  });
});

describe('a password reset ends the sessions that already exist', () => {
  it('refuses a token minted before the reset', async () => {
    // A second owner, so revoking their sessions cannot disturb the rest of
    // this suite's assertions.
    const email = `reset-${suffix}@example.test`;
    const created = await asA(request(app).post('/admins')).send({
      email,
      name: 'Reset Target',
      role: 'staff',
    });
    expect(created.status).toBe(201);
    const targetId = created.body.admin.id;

    const token = (
      await request(app).post('/auth/login').send({ email, password: created.body.tempPassword })
    ).body.accessToken;

    const before = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    // A reset that leaves existing tokens working is not a reset: whoever the
    // password was being taken away from keeps their session for up to the
    // refresh-token lifetime.
    const reset = await asA(request(app).patch(`/admins/${targetId}`)).send({ resetPassword: true });
    expect(reset.status).toBe(200);

    const after = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('the platform role is not a way around company scoping either', () => {
  it('a platform token cannot use company-scoped routes without impersonating', async () => {
    const res = await request(app).get('/products').set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_REQUIRED');
  });

  it('impersonation is audit-logged with the acting admin, every time', async () => {
    const before = await withPlatform((conn) =>
      conn
        .execute(`SELECT COUNT(*) AS n FROM logs WHERE action = 'impersonate' AND company_id = :id`, {
          id: companyBId,
        })
        .then((result) => result.rows[0].N),
    );

    const res = await request(app)
      .post(`/platform/companies/${companyBId}/impersonate`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({});
    expect(res.status).toBe(200);

    const rows = await withPlatform((conn) =>
      conn
        .execute(
          `SELECT admin_id FROM logs WHERE action = 'impersonate' AND company_id = :id
            ORDER BY created_at DESC FETCH FIRST 1 ROWS ONLY`,
          { id: companyBId },
        )
        .then((result) => result.rows),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ADMIN_ID).toBe(platformAdminId);

    const after = await withPlatform((conn) =>
      conn
        .execute(`SELECT COUNT(*) AS n FROM logs WHERE action = 'impersonate' AND company_id = :id`, {
          id: companyBId,
        })
        .then((result) => result.rows[0].N),
    );
    expect(after).toBe(before + 1);
  });
});
