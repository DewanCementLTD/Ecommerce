import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `settings-owner-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let ownerId;
let companyId;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Settings Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    ownerId = (
      await conn.execute(
        `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
         VALUES (:companyId, :email, :passHash, 'Owner', 'owner', 1)
         RETURNING id INTO :id`,
        { companyId, email, passHash, id: OUT_ID },
      )
    ).outBinds.id[0];
    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyId]);
  });
  await closeRedis();
  await closePool();
});

describe('settings', () => {
  it('starts empty', async () => {
    const res = await auth(request(app).get('/settings'));
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({});
  });

  it('saves and reads back multiple keys', async () => {
    const res = await auth(request(app).put('/settings')).send({
      values: { seo_title: 'My Store', currency_label: 'USD' },
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ seo_title: 'My Store', currency_label: 'USD' });
  });

  it('overwrites an existing key without disturbing others', async () => {
    const res = await auth(request(app).put('/settings')).send({ values: { seo_title: 'Renamed Store' } });
    expect(res.body.settings).toMatchObject({ seo_title: 'Renamed Store', currency_label: 'USD' });
  });

  it('rejects an empty body', async () => {
    expect((await auth(request(app).put('/settings')).send({ values: {} })).status).toBe(400);
  });
});

describe('staff', () => {
  let staffId;

  it('lists just the owner to start', async () => {
    const res = await auth(request(app).get('/admins'));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ email, role: 'owner' });
  });

  it('creates a staff account with a one-time password', async () => {
    const res = await auth(request(app).post('/admins')).send({
      email: `staff-${suffix}@example.test`,
      name: 'Store Staff',
      role: 'staff',
    });
    expect(res.status).toBe(201);
    expect(res.body.admin).toMatchObject({ name: 'Store Staff', role: 'staff', isActive: 1 });
    expect(typeof res.body.tempPassword).toBe('string');
    expect(res.body.tempPassword.length).toBeGreaterThan(8);
    staffId = res.body.admin.id;
  });

  it('rejects a duplicate email', async () => {
    const res = await auth(request(app).post('/admins')).send({ email, name: 'Dupe', role: 'staff' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('updates the staff member', async () => {
    const res = await auth(request(app).patch(`/admins/${staffId}`)).send({ name: 'Renamed Staff' });
    expect(res.status).toBe(200);
    expect(res.body.admin.name).toBe('Renamed Staff');
  });

  it('refuses to deactivate the last active admin', async () => {
    /*
     * The staff account is deactivated first, not the owner's.
     *
     * Deactivating an account revokes every token it holds
     * (api/src/lib/sessions.js) — so a version of this test that switched the
     * owner off to reach the guard was killing the very bearer token it was
     * using, and every assertion after that line came back 401. Re-logging in
     * afterwards does not help either: the account is inactive by then, and a
     * revocation is a point in time rather than a flag that re-activating
     * clears.
     *
     * Driving it the other way round tests the same guard and leaves this
     * suite's session alone.
     */
    const staffOff = await auth(request(app).patch(`/admins/${staffId}`)).send({ isActive: false });
    expect(staffOff.status).toBe(200);

    // The owner is now the only active admin, so switching them off must fail.
    const last = await auth(request(app).patch(`/admins/${ownerId}`)).send({ isActive: false });
    expect(last.status).toBe(409);
    expect(last.body.error.code).toBe('LAST_ADMIN');

    // Restore the staff member so the remaining tests (and cleanup) keep working.
    const restored = await auth(request(app).patch(`/admins/${staffId}`)).send({ isActive: true });
    expect(restored.status).toBe(200);
  });

  it('refuses to let an admin delete themselves', async () => {
    const meRes = await auth(request(app).get('/auth/me'));
    const res = await auth(request(app).delete(`/admins/${meRes.body.admin.id}`));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CANNOT_DELETE_SELF');
  });

  it('deletes the staff member', async () => {
    const res = await auth(request(app).delete(`/admins/${staffId}`));
    expect(res.status).toBe(200);
    const list = await auth(request(app).get('/admins'));
    expect(list.body.rows.map((r) => r.id)).not.toContain(staffId);
  });
});

describe('roles', () => {
  let roleId;

  it('creates a role', async () => {
    const res = await auth(request(app).post('/roles')).send({
      code: 'inventory',
      name: 'Inventory Manager',
      perms: ['products.write', 'products.read'],
    });
    expect(res.status).toBe(201);
    expect(res.body.role).toMatchObject({ code: 'inventory', name: 'Inventory Manager' });
    expect(res.body.role.perms).toEqual(['products.write', 'products.read']);
    roleId = res.body.role.id;
  });

  it('rejects a duplicate role code', async () => {
    const res = await auth(request(app).post('/roles')).send({ code: 'inventory', name: 'Again', perms: [] });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ROLE_CODE_TAKEN');
  });

  it('updates a role', async () => {
    const res = await auth(request(app).patch(`/roles/${roleId}`)).send({ perms: ['products.read'] });
    expect(res.status).toBe(200);
    expect(res.body.role.perms).toEqual(['products.read']);
  });

  it('deletes a role', async () => {
    const res = await auth(request(app).delete(`/roles/${roleId}`));
    expect(res.status).toBe(200);
    const list = await auth(request(app).get('/roles'));
    expect(list.body.rows.map((r) => r.id)).not.toContain(roleId);
  });
});
