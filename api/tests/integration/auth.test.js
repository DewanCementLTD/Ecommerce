import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { getRedis, closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `auth-test-a-${suffix}@example.test`;
const emailWrongPw = `auth-test-wrongpw-${suffix}@example.test`;

let companyAId;
let adminAId;
let adminWrongPwId;

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    await conn.execute('INSERT INTO companies (name, status) VALUES (:name, :status)', {
      name: `Auth Test Co ${suffix}`,
      status: 'active',
    });
    const companyResult = await conn.execute('SELECT id FROM companies WHERE name = :name', {
      name: `Auth Test Co ${suffix}`,
    });
    companyAId = companyResult.rows[0].ID;

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Auth Test Admin A', 'owner', 1)`,
      { companyId: companyAId, email: emailA, passHash },
    );
    const adminResult = await conn.execute('SELECT id FROM admins WHERE email = :email', { email: emailA });
    adminAId = adminResult.rows[0].ID;

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Auth Test Admin Lockout', 'owner', 1)`,
      { companyId: companyAId, email: emailWrongPw, passHash },
    );
    const wrongPwResult = await conn.execute('SELECT id FROM admins WHERE email = :email', {
      email: emailWrongPw,
    });
    adminWrongPwId = wrongPwResult.rows[0].ID;

    await conn.commit();
  });
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM logs WHERE admin_id IN (:a, :b)', {
      a: adminAId,
      b: adminWrongPwId,
    });
    await conn.execute('DELETE FROM admins WHERE id IN (:a, :b)', { a: adminAId, b: adminWrongPwId });
    await conn.execute('DELETE FROM companies WHERE id = :id', { id: companyAId });
    await conn.commit();
  });

  const redis = getRedis();
  await redis.del(`auth:fail:${emailA.toLowerCase()}`, `auth:fail:${emailWrongPw.toLowerCase()}`);

  await closeRedis();
  await closePool();
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials and issues a scoped token', async () => {
    const res = await request(createApp()).post('/auth/login').send({ email: emailA, password });
    expect(res.status).toBe(200);
    expect(res.body.admin.companyId).toBe(companyAId);
    expect(res.body.admin.role).toBe('owner');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
  });

  it('rejects a wrong password', async () => {
    const res = await request(createApp())
      .post('/auth/login')
      .send({ email: emailA, password: 'not the password' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks out after 5 failed attempts within the window', async () => {
    const app = createApp();
    for (let i = 0; i < 5; i++) {
      await request(app).post('/auth/login').send({ email: emailWrongPw, password: 'nope' });
    }
    const res = await request(app).post('/auth/login').send({ email: emailWrongPw, password: 'nope' });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_ATTEMPTS');

    const evenWithCorrectPassword = await request(app)
      .post('/auth/login')
      .send({ email: emailWrongPw, password });
    expect(evenWithCorrectPassword.status).toBe(429);
  });
});

describe('authenticated routes', () => {
  it('GET /auth/me returns the token owner, ignoring any client-supplied company id', async () => {
    const app = createApp();
    const login = await request(app).post('/auth/login').send({ email: emailA, password });
    const { accessToken } = login.body;

    const res = await request(app)
      .get('/auth/me?company_id=999999')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Company-Id', '999999');

    expect(res.status).toBe(200);
    expect(res.body.admin.companyId).toBe(companyAId);
    expect(res.body.admin.id).toBe(adminAId);
  });

  it('rejects requests with no token, and with a malformed token', async () => {
    const app = createApp();
    const noToken = await request(app).get('/auth/me');
    expect(noToken.status).toBe(401);

    const badToken = await request(app).get('/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(badToken.status).toBe(401);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const app = createApp();
    const login = await request(app).post('/auth/login').send({ email: emailA, password });
    const { refreshToken } = login.body;

    const refreshed = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTypeOf('string');
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);

    const reused = await request(app).post('/auth/refresh').send({ refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('INVALID_TOKEN');
  });

  it('blacklists the access token on logout', async () => {
    const app = createApp();
    const login = await request(app).post('/auth/login').send({ email: emailA, password });
    const { accessToken } = login.body;

    const meBefore = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meBefore.status).toBe(200);

    const logoutRes = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutRes.status).toBe(204);

    const meAfter = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(meAfter.status).toBe(401);
  });
});
