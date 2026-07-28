import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const adminPassword = 'correct horse battery staple';
const adminEmail = `cust-owner-${suffix}@example.test`;
const host = `cust-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let adminToken;
let companyId;

const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken}`);
const shop = (method, path) => request(app)[method](path).set('X-Forwarded-Host', host);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(adminPassword);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Customers Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];
    await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
      companyId,
      host,
    });
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Owner', 'owner', 1)`,
      { companyId, email: adminEmail, passHash },
    );
    await conn.commit();
  });

  app = createApp();
  adminToken = (await request(app).post('/auth/login').send({ email: adminEmail, password: adminPassword })).body
    .accessToken;
});

afterAll(async () => {
  await getRedis().del(`sf:host:${host}`);
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [companyId]);
  });
  await closeRedis();
  await closePool();
});

const customerEmail = `jane-${suffix}@example.test`;
const customerPassword = 'super secret pass';
let customerToken;
let customerRefreshToken;
let customerId;

describe('customer auth', () => {
  it('registers a new account', async () => {
    const res = await shop('post', '/shop/account/register').send({
      email: customerEmail,
      password: customerPassword,
      name: 'Jane Doe',
      phone: '+1 555 0100',
    });
    expect(res.status).toBe(201);
    expect(res.body.customer).toMatchObject({ email: customerEmail, name: 'Jane Doe' });
    expect(res.body.customer.passHash).toBeUndefined();
    customerToken = res.body.accessToken;
    customerRefreshToken = res.body.refreshToken;
    customerId = res.body.customer.id;
  });

  it('rejects a duplicate registration', async () => {
    const res = await shop('post', '/shop/account/register').send({
      email: customerEmail,
      password: 'whatever12',
      name: 'Someone Else',
      phone: '+1 555 0101',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with correct credentials', async () => {
    const res = await shop('post', '/shop/account/login').send({ email: customerEmail, password: customerPassword });
    expect(res.status).toBe(200);
    expect(res.body.customer.id).toBe(customerId);
  });

  it('rejects a wrong password', async () => {
    const res = await shop('post', '/shop/account/login').send({ email: customerEmail, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('reads its own profile', async () => {
    const res = await shop('get', '/shop/account/me').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBe(customerEmail);
  });

  it('rejects an admin token on customer routes', async () => {
    const res = await shop('get', '/shop/account/me').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(401);
  });

  it('updates its own profile', async () => {
    const res = await shop('patch', '/shop/account/me').set('Authorization', `Bearer ${customerToken}`).send({
      name: 'Jane R. Doe',
    });
    expect(res.status).toBe(200);
    expect(res.body.customer.name).toBe('Jane R. Doe');
  });

  it('refreshes the access token', async () => {
    const res = await shop('post', '/shop/account/refresh').send({ refreshToken: customerRefreshToken });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    customerToken = res.body.accessToken;
  });

  it('logs out and blacklists the token', async () => {
    const res = await shop('post', '/shop/account/logout').set('Authorization', `Bearer ${customerToken}`);
    expect(res.status).toBe(204);
    const after = await shop('get', '/shop/account/me').set('Authorization', `Bearer ${customerToken}`);
    expect(after.status).toBe(401);
  });
});

describe('addresses', () => {
  let freshToken;
  let addrId;

  beforeAll(async () => {
    const res = await shop('post', '/shop/account/login').send({ email: customerEmail, password: customerPassword });
    freshToken = res.body.accessToken;
  });

  it('starts with no addresses', async () => {
    const res = await shop('get', '/shop/account/addresses').set('Authorization', `Bearer ${freshToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
  });

  it('adds an address', async () => {
    const res = await shop('post', '/shop/account/addresses').set('Authorization', `Bearer ${freshToken}`).send({
      name: 'Jane Doe',
      phone: '+1 555 0100',
      line1: '123 Main St',
      city: 'Springfield',
      isDefault: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ city: 'Springfield', isDefault: 1 });
    addrId = res.body.rows[0].id;
  });

  it('adding a second default address clears the first', async () => {
    const res = await shop('post', '/shop/account/addresses').set('Authorization', `Bearer ${freshToken}`).send({
      name: 'Jane Doe',
      phone: '+1 555 0100',
      line1: '456 Oak Ave',
      city: 'Springfield',
      isDefault: true,
    });
    expect(res.status).toBe(201);
    const defaults = res.body.rows.filter((a) => a.isDefault === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].line1).toBe('456 Oak Ave');
  });

  it('updates an address', async () => {
    const res = await shop('patch', `/shop/account/addresses/${addrId}`).set('Authorization', `Bearer ${freshToken}`).send({
      city: 'Shelbyville',
    });
    expect(res.status).toBe(200);
    expect(res.body.rows.find((a) => a.id === addrId).city).toBe('Shelbyville');
  });

  it('deletes an address', async () => {
    const res = await shop('delete', `/shop/account/addresses/${addrId}`).set('Authorization', `Bearer ${freshToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.find((a) => a.id === addrId)).toBeUndefined();
  });
});

describe('admin customer management', () => {
  it('lists customers for the company', async () => {
    const res = await asAdmin(request(app).get('/customers'));
    expect(res.status).toBe(200);
    expect(res.body.rows.some((c) => c.email === customerEmail)).toBe(true);
  });

  it('searches by name', async () => {
    const res = await asAdmin(request(app).get('/customers?search=Jane'));
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
  });

  it('reads a single customer', async () => {
    const res = await asAdmin(request(app).get(`/customers/${customerId}`));
    expect(res.status).toBe(200);
    expect(res.body.customer.email).toBe(customerEmail);
  });

  it('deactivates a customer, blocking further login', async () => {
    const res = await asAdmin(request(app).patch(`/customers/${customerId}`)).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.customer.isActive).toBe(0);

    const loginAttempt = await shop('post', '/shop/account/login').send({
      email: customerEmail,
      password: customerPassword,
    });
    expect(loginAttempt.status).toBe(401);
  });
});
