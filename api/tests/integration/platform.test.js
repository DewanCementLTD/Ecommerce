import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { getRedis, closeRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const platformEmail = process.env.PLATFORM_ADMIN_EMAIL;
const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD;

const ownerEmail = `platform-test-owner-${suffix}@example.test`;
const ownerPassword = 'correct horse battery staple';

let platformToken;
let ownerCompanyId;
let ownerToken;

const createdCompanyIds = [];

beforeAll(async () => {
  await initPool();

  await withPlatform(async (conn) => {
    await conn.execute('INSERT INTO companies (name, status) VALUES (:name, :status)', {
      name: `Platform Test Owner Co ${suffix}`,
      status: 'active',
    });
    const company = await conn.execute('SELECT id FROM companies WHERE name = :name', {
      name: `Platform Test Owner Co ${suffix}`,
    });
    ownerCompanyId = company.rows[0].ID;

    const passHash = await argon2.hash(ownerPassword);
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Owner Admin', 'owner', 1)`,
      { companyId: ownerCompanyId, email: ownerEmail, passHash },
    );

    await conn.commit();
  });

  const app = createApp();
  const platformLogin = await request(app)
    .post('/auth/login')
    .send({ email: platformEmail, password: platformPassword });
  platformToken = platformLogin.body.accessToken;

  const ownerLogin = await request(app).post('/auth/login').send({ email: ownerEmail, password: ownerPassword });
  ownerToken = ownerLogin.body.accessToken;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    await deleteCompanies(conn, [...createdCompanyIds, ownerCompanyId]);
  });

  await closeRedis();
  await closePool();
});

describe('role gating', () => {
  it('rejects requests with no token', async () => {
    const res = await request(createApp()).get('/platform/companies');
    expect(res.status).toBe(401);
  });

  it('rejects a non-platform admin token', async () => {
    const res = await request(createApp())
      .get('/platform/companies')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('POST /platform/companies', () => {
  it('provisions a company with a working admin login, in one transaction', async () => {
    const app = createApp();
    const domainHost = `platform-test-new-${suffix}.example.test`;
    const adminEmail = `platform-test-newadmin-${suffix}@example.test`;

    const res = await request(app)
      .post('/platform/companies')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        name: `Provisioned Co ${suffix}`,
        domainHost,
        adminEmail,
        adminName: 'New Admin',
      });

    expect(res.status).toBe(201);
    expect(res.body.company.STATUS).toBe('active');
    expect(res.body.domain.host).toBe(domainHost);
    expect(res.body.admin.tempPassword).toBeTypeOf('string');
    createdCompanyIds.push(res.body.company.ID);

    const loginRes = await request(app)
      .post('/auth/login')
      .send({ email: adminEmail, password: res.body.admin.tempPassword });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.admin.companyId).toBe(res.body.company.ID);
  });

  it('provisions a store that is usable immediately — pages, home sections, categories and menus', async () => {
    // Steps 6-9 of 00-SYSTEM-DESIGN.md §6, the Phase 0 carry-over. Without
    // these, "creating a company gives a working store" was only true in the
    // Phase 0 sense: a login and a domain, but nothing to render.
    const app = createApp();
    const suffixLocal = `${suffix}-usable`;

    const res = await request(app)
      .post('/platform/companies')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        name: `Usable Co ${suffixLocal}`,
        domainHost: `usable-${suffixLocal}.example.test`,
        adminEmail: `usable-${suffixLocal}@example.test`,
        adminName: 'Usable Admin',
      });
    expect(res.status).toBe(201);
    const companyId = res.body.company.ID;
    createdCompanyIds.push(companyId);

    const token = (
      await request(app)
        .post('/auth/login')
        .send({ email: `usable-${suffixLocal}@example.test`, password: res.body.admin.tempPassword })
    ).body.accessToken;
    const auth = (req) => req.set('Authorization', `Bearer ${token}`);

    const pages = await auth(request(app).get('/pages'));
    expect(pages.body.rows.map((row) => row.slug).sort()).toEqual(['about', 'contact', 'home', 'privacy']);

    const home = pages.body.rows.find((row) => row.type === 'home');
    const sections = await auth(request(app).get(`/pages/${home.id}/sections`));
    expect(sections.body.rows.map((row) => row.type)).toEqual([
      'hero',
      'cat_tiles',
      'prod_row',
      'features',
      'news',
    ]);
    // Registry defaults, not empty JSON — the arranger can edit these as-is.
    expect(sections.body.rows[0].settings.interval).toBe(6);

    const cats = await auth(request(app).get('/cats/tree'));
    expect(cats.body.tree.length).toBe(3);

    const menus = await auth(request(app).get('/menus'));
    expect(menus.body.rows.map((row) => row.code).sort()).toEqual(['footer', 'header']);

    const headerId = menus.body.rows.find((row) => row.code === 'header').id;
    const headerItems = await auth(request(app).get(`/menus/${headerId}/items`));
    expect(headerItems.body.items).toHaveLength(3);
    expect(headerItems.body.items[0].linkType).toBe('cat');

    const footerId = menus.body.rows.find((row) => row.code === 'footer').id;
    const footerItems = await auth(request(app).get(`/menus/${footerId}/items`));
    expect(footerItems.body.items.map((item) => item.label)).toEqual(['About', 'Contact', 'Privacy']);
  });

  it('rejects a duplicate domain and rolls back the whole transaction', async () => {
    const app = createApp();
    const domainHost = `platform-test-dupe-${suffix}.example.test`;
    const adminEmail1 = `platform-test-dupe1-${suffix}@example.test`;
    const adminEmail2 = `platform-test-dupe2-${suffix}@example.test`;

    const first = await request(app)
      .post('/platform/companies')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: `Dupe Co ${suffix}`, domainHost, adminEmail: adminEmail1, adminName: 'A' });
    expect(first.status).toBe(201);
    createdCompanyIds.push(first.body.company.ID);

    const second = await request(app)
      .post('/platform/companies')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ name: `Dupe Co 2 ${suffix}`, domainHost, adminEmail: adminEmail2, adminName: 'B' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DOMAIN_TAKEN');

    const companiesWithName = await withPlatform(async (conn) => {
      const r = await conn.execute('SELECT id FROM companies WHERE name = :name', {
        name: `Dupe Co 2 ${suffix}`,
      });
      return r.rows;
    });
    expect(companiesWithName.length).toBe(0);
  });
});

describe('company management', () => {
  let companyId;
  let domainId;

  beforeAll(async () => {
    const res = await request(createApp())
      .post('/platform/companies')
      .set('Authorization', `Bearer ${platformToken}`)
      .send({
        name: `Manage Co ${suffix}`,
        domainHost: `platform-test-manage-${suffix}.example.test`,
        adminEmail: `platform-test-manage-admin-${suffix}@example.test`,
        adminName: 'Manage Admin',
      });
    companyId = res.body.company.ID;
    createdCompanyIds.push(companyId);
  });

  it('lists and filters companies', async () => {
    const res = await request(createApp())
      .get(`/platform/companies?search=Manage Co ${suffix}`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.some((row) => row.ID === companyId)).toBe(true);
  });

  it('gets and patches a company', async () => {
    const app = createApp();
    const getRes = await request(app)
      .get(`/platform/companies/${companyId}`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(getRes.status).toBe(200);

    const patchRes = await request(app)
      .patch(`/platform/companies/${companyId}`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ currency: 'USD' });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.company.CURRENCY).toBe('USD');
  });

  it('suspends and activates a company', async () => {
    const app = createApp();
    const suspendRes = await request(app)
      .post(`/platform/companies/${companyId}/suspend`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(suspendRes.status).toBe(204);

    const afterSuspend = await request(app)
      .get(`/platform/companies/${companyId}`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(afterSuspend.body.company.STATUS).toBe('suspended');

    const activateRes = await request(app)
      .post(`/platform/companies/${companyId}/activate`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(activateRes.status).toBe(204);
  });

  it('lists a company\'s settings and domains for the detail screen', async () => {
    const app = createApp();
    const settingsRes = await request(app)
      .get(`/platform/companies/${companyId}/settings`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(settingsRes.status).toBe(200);
    expect(settingsRes.body.settings.some((s) => s.KEY === 'seo_title')).toBe(true);

    const domainsRes = await request(app)
      .get(`/platform/companies/${companyId}/domains`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(domainsRes.status).toBe(200);
    expect(domainsRes.body.domains.length).toBeGreaterThan(0);
  });

  it('adds a domain and busts the Redis cache when it is removed', async () => {
    const app = createApp();
    const newHost = `platform-test-extra-${suffix}.example.test`;

    const addRes = await request(app)
      .post(`/platform/companies/${companyId}/domains`)
      .set('Authorization', `Bearer ${platformToken}`)
      .send({ host: newHost });
    expect(addRes.status).toBe(201);
    domainId = addRes.body.domain.id;

    await request(app).get('/storefront/company').set('Host', newHost);
    const cachedBefore = await getRedis().get(`sf:host:${newHost}`);
    expect(cachedBefore).toBe(String(companyId));

    const deleteRes = await request(app)
      .delete(`/platform/domains/${domainId}`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(deleteRes.status).toBe(204);

    const cachedAfter = await getRedis().get(`sf:host:${newHost}`);
    expect(cachedAfter).toBeNull();

    const afterDelete = await request(app).get('/storefront/company').set('Host', newHost);
    expect(afterDelete.status).toBe(404);
  });

  it('impersonates: issues a short-lived scoped token and logs the action', async () => {
    const app = createApp();
    const res = await request(app)
      .post(`/platform/companies/${companyId}/impersonate`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeUndefined();

    const meRes = await request(app).get('/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(meRes.status).toBe(200);
    expect(meRes.body.admin.companyId).toBe(companyId);

    const logRows = await withPlatform(async (conn) => {
      const r = await conn.execute(
        "SELECT action FROM logs WHERE company_id = :id AND action = 'impersonate'",
        { id: companyId },
      );
      return r.rows;
    });
    expect(logRows.length).toBeGreaterThan(0);
  });

  it('GET /platform/logs lists this company\'s audit entries with meta as a JSON string', async () => {
    const res = await request(createApp())
      .get(`/platform/logs?companyId=${companyId}`)
      .set('Authorization', `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);

    const domainAdded = res.body.rows.find((row) => row.ACTION === 'domain_added');
    expect(domainAdded).toBeDefined();
    expect(typeof domainAdded.META).toBe('string');
    expect(() => JSON.parse(domainAdded.META)).not.toThrow();
  });
});
