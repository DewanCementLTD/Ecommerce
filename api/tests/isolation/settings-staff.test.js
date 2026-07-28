import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const emailA = `iso-staff-a-${suffix}@example.test`;
const emailB = `iso-staff-b-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let companyAId;
let companyBId;
let tokenA;
let tokenB;
let staffAId;
let roleAId;

const asA = (req) => req.set('Authorization', `Bearer ${tokenA}`);
const asB = (req) => req.set('Authorization', `Bearer ${tokenB}`);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    const seed = async (name, email) => {
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
      return companyId;
    };

    companyAId = await seed(`Iso Staff A ${suffix}`, emailA);
    companyBId = await seed(`Iso Staff B ${suffix}`, emailB);
    await conn.commit();
  });

  app = createApp();
  tokenA = (await request(app).post('/auth/login').send({ email: emailA, password })).body.accessToken;
  tokenB = (await request(app).post('/auth/login').send({ email: emailB, password })).body.accessToken;

  await asA(request(app).put('/settings')).send({ values: { secret_note: "A's secret" } });

  staffAId = (
    await asA(request(app).post('/admins')).send({ email: `iso-staff-member-a-${suffix}@example.test`, name: 'A Staff', role: 'staff' })
  ).body.admin.id;

  roleAId = (await asA(request(app).post('/roles')).send({ code: 'manager', name: "A's Manager", perms: [] })).body
    .role.id;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyAId, companyBId]);
  });
  await closeRedis();
  await closePool();
});

describe('settings: cross-company isolation (release gate)', () => {
  it("B's settings start empty despite A having some", async () => {
    const res = await asB(request(app).get('/settings'));
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({});
  });

  it('raw no-predicate SQL under B context cannot see A settings rows (proves VPD)', async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute("SELECT id FROM settings WHERE key = 'secret_note'", {});
      return result.rows;
    });
    expect(seenByB).toHaveLength(0);

    const seenByA = await withCompany(companyAId, async (conn) => {
      const result = await conn.execute("SELECT id FROM settings WHERE key = 'secret_note'", {});
      return result.rows;
    });
    expect(seenByA).toHaveLength(1);
  });
});

describe('staff: cross-company isolation (release gate)', () => {
  it("B cannot read A's staff member", async () => {
    const res = await asB(request(app).patch(`/admins/${staffAId}`)).send({ name: 'Hijacked' });
    expect(res.status).toBe(404);
  });

  it("B cannot delete A's staff member", async () => {
    const res = await asB(request(app).delete(`/admins/${staffAId}`));
    expect(res.status).toBe(404);

    const stillThere = await asA(request(app).get('/admins'));
    expect(stillThere.body.rows.map((r) => r.id)).toContain(staffAId);
  });

  it("B's admin list contains only its own owner", async () => {
    const res = await asB(request(app).get('/admins'));
    expect(res.body.rows.map((r) => r.email)).toEqual([emailB]);
  });

  it('a globally-unique email cannot be reused by a different company (admins.email is unique across the platform, by design)', async () => {
    const res = await asB(request(app).post('/admins')).send({
      email: `iso-staff-member-a-${suffix}@example.test`,
      name: 'Collide',
      role: 'staff',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it("B cannot read or delete A's role", async () => {
    const patchRes = await asB(request(app).patch(`/roles/${roleAId}`)).send({ name: 'Hijacked' });
    expect(patchRes.status).toBe(404);

    const deleteRes = await asB(request(app).delete(`/roles/${roleAId}`));
    expect(deleteRes.status).toBe(404);

    const stillThere = await asA(request(app).get('/roles'));
    expect(stillThere.body.rows.map((r) => r.id)).toContain(roleAId);
  });

  it('B can reuse the same role code as A — role codes are unique per company, not globally', async () => {
    const res = await asB(request(app).post('/roles')).send({ code: 'manager', name: "B's Manager", perms: [] });
    expect(res.status).toBe(201);
  });

  it('raw no-predicate SQL under B context cannot see A admins/roles rows (proves VPD)', async () => {
    const seenByB = await withCompany(companyBId, async (conn) => {
      const admins = await conn.execute('SELECT id FROM admins WHERE id = :id', { id: staffAId });
      const roles = await conn.execute('SELECT id FROM roles WHERE id = :id', { id: roleAId });
      return { admins: admins.rows, roles: roles.rows };
    });
    expect(seenByB.admins).toHaveLength(0);
    expect(seenByB.roles).toHaveLength(0);
  });
});
