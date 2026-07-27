import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import sharp from 'sharp';
import request from 'supertest';
import { SECTION_TYPES } from '@storeforge/shared';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `content-owner-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let companyId;
let homePageId;
let mediaId;
let headerMenuId;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Content Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Content Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );

    homePageId = (
      await conn.execute(
        `INSERT INTO pages (company_id, title, slug, type) VALUES (:companyId, 'Home', 'home', 'home')
         RETURNING id INTO :id`,
        { companyId, id: OUT_ID },
      )
    ).outBinds.id[0];

    headerMenuId = (
      await conn.execute(
        `INSERT INTO menus (company_id, code, name) VALUES (:companyId, 'header', 'Header')
         RETURNING id INTO :id`,
        { companyId, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;

  const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#222' } })
    .png()
    .toBuffer();
  mediaId = (await auth(request(app).post('/media')).attach('file', png, 'banner.png')).body.media.ID;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM menu_items WHERE company_id = :companyId AND parent_id IS NOT NULL',
      'DELETE FROM menu_items WHERE company_id = :companyId',
      'DELETE FROM menus WHERE company_id = :companyId',
      'DELETE FROM banners WHERE company_id = :companyId',
      'DELETE FROM sections WHERE company_id = :companyId',
      'DELETE FROM pages WHERE company_id = :companyId',
      'DELETE FROM media WHERE company_id = :companyId',
      'DELETE FROM logs WHERE company_id = :companyId',
      'DELETE FROM admins WHERE company_id = :companyId',
      'DELETE FROM companies WHERE id = :companyId',
    ]) {
      await conn.execute(sql, { companyId });
    }
    await conn.commit();
  });
  await closeRedis();
  await closePool();
});

describe('pages', () => {
  it('creates a page with a derived slug', async () => {
    const res = await auth(request(app).post('/pages')).send({ title: `Delivery info ${suffix}` });
    expect(res.status).toBe(201);
    expect(res.body.page.slug).toBe(`delivery-info-${suffix}`);
    expect(res.body.page.type).toBe('page');
  });

  it('refuses to delete the home page', async () => {
    const res = await auth(request(app).delete(`/pages/${homePageId}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HOME_PAGE_PROTECTED');
  });

  it('deletes an ordinary page and its sections together', async () => {
    const page = (await auth(request(app).post('/pages')).send({ title: `Doomed page ${suffix}` })).body.page;
    await auth(request(app).post(`/pages/${page.id}/sections`)).send({ type: 'rich' });

    const res = await auth(request(app).delete(`/pages/${page.id}`));
    expect(res.status).toBe(200);
    expect(res.body.removedSections).toBe(1);
    expect((await auth(request(app).get(`/pages/${page.id}`))).status).toBe(404);
  });

  it('lists the home page first', async () => {
    const res = await auth(request(app).get('/pages'));
    expect(res.body.rows[0].type).toBe('home');
  });
});

describe('sections', () => {
  it('exposes the shared registry to the admin', async () => {
    const res = await auth(request(app).get('/sections/registry'));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.sections).sort()).toEqual([...SECTION_TYPES].sort());
    expect(res.body.sections.hero.fields.some((field) => field.key === 'bannerIds')).toBe(true);
  });

  it('adds a section with the registry defaults filled in', async () => {
    const res = await auth(request(app).post(`/pages/${homePageId}/sections`)).send({ type: 'hero' });
    expect(res.status).toBe(201);
    const hero = res.body.rows.find((row) => row.type === 'hero');
    expect(hero.settings).toMatchObject({ bannerIds: [], autoplay: true, interval: 6, height: 'medium' });
  });

  it('rejects a type the registry does not know', async () => {
    const res = await auth(request(app).post(`/pages/${homePageId}/sections`)).send({ type: 'carousel3d' });
    expect(res.status).toBe(400);
  });

  it('merges settings on patch and keeps unknown keys out', async () => {
    const added = await auth(request(app).post(`/pages/${homePageId}/sections`)).send({ type: 'prod_row' });
    const section = added.body.rows.find((row) => row.type === 'prod_row');

    const res = await auth(request(app).patch(`/sections/${section.id}`)).send({
      settings: { title: 'Fresh this week', limit: 12, nonsense: 'ignored' },
    });
    expect(res.status).toBe(200);
    const updated = res.body.rows.find((row) => row.id === section.id);
    expect(updated.settings.title).toBe('Fresh this week');
    expect(updated.settings.limit).toBe(12);
    expect(updated.settings.source).toBe('newest'); // untouched default survives
    expect(updated.settings.nonsense).toBeUndefined();
  });

  it('toggles a section off without deleting it', async () => {
    const added = await auth(request(app).post(`/pages/${homePageId}/sections`)).send({ type: 'news' });
    const section = added.body.rows.find((row) => row.type === 'news');

    const res = await auth(request(app).patch(`/sections/${section.id}`)).send({ isActive: false });
    expect(res.body.rows.find((row) => row.id === section.id).isActive).toBe(0);
  });

  it('reorders every section in one transaction', async () => {
    const page = (await auth(request(app).post('/pages')).send({ title: `Ordered ${suffix}` })).body.page;
    for (const type of ['hero', 'cat_tiles', 'features']) {
      await auth(request(app).post(`/pages/${page.id}/sections`)).send({ type });
    }
    const before = (await auth(request(app).get(`/pages/${page.id}/sections`))).body.rows;
    expect(before.map((row) => row.type)).toEqual(['hero', 'cat_tiles', 'features']);

    const res = await auth(request(app).post(`/pages/${page.id}/sections/reorder`)).send({
      items: [
        { id: before[2].id, position: 0 },
        { id: before[0].id, position: 1 },
        { id: before[1].id, position: 2 },
      ],
    });
    expect(res.body.rows.map((row) => row.type)).toEqual(['features', 'hero', 'cat_tiles']);
  });

  it('rejects a reorder naming a section from another page, changing nothing', async () => {
    const page = (await auth(request(app).post('/pages')).send({ title: `Untouched ${suffix}` })).body.page;
    const added = await auth(request(app).post(`/pages/${page.id}/sections`)).send({ type: 'rich' });
    const mine = added.body.rows[0];

    const other = (await auth(request(app).get(`/pages/${homePageId}/sections`))).body.rows[0];

    const res = await auth(request(app).post(`/pages/${page.id}/sections/reorder`)).send({
      items: [
        { id: mine.id, position: 5 },
        { id: other.id, position: 0 },
      ],
    });
    expect(res.status).toBe(404);

    const after = (await auth(request(app).get(`/pages/${page.id}/sections`))).body.rows;
    expect(after[0].position).toBe(0);
  });

  it('deletes a section', async () => {
    const added = await auth(request(app).post(`/pages/${homePageId}/sections`)).send({ type: 'promo' });
    const section = added.body.rows.find((row) => row.type === 'promo');
    const res = await auth(request(app).delete(`/sections/${section.id}`));
    expect(res.body.rows.some((row) => row.id === section.id)).toBe(false);
  });
});

describe('banners', () => {
  it('creates one with a desktop and a mobile crop', async () => {
    const res = await auth(request(app).post('/banners')).send({
      name: `Summer ${suffix}`,
      mediaId,
      mediaMobileId: mediaId,
      link: '/cats/steaks',
      alt: 'Summer grilling',
    });
    expect(res.status).toBe(201);
    expect(res.body.banner.mediaMobileId).toBe(mediaId);
  });

  it('rejects an image from outside the store', async () => {
    const res = await auth(request(app).post('/banners')).send({
      name: `Bad image ${suffix}`,
      mediaId: 999_999_999,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_NOT_FOUND');
  });

  it('rejects a schedule that ends before it starts', async () => {
    const res = await auth(request(app).post('/banners')).send({
      name: `Backwards ${suffix}`,
      startsAt: '2026-08-01T00:00:00Z',
      endsAt: '2026-07-01T00:00:00Z',
    });
    expect(res.status).toBe(400);
  });

  it('filters to live banners by schedule', async () => {
    const past = await auth(request(app).post('/banners')).send({
      name: `Expired ${suffix}`,
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2020-02-01T00:00:00Z',
    });
    const future = await auth(request(app).post('/banners')).send({
      name: `Not yet ${suffix}`,
      startsAt: '2090-01-01T00:00:00Z',
    });
    const now = await auth(request(app).post('/banners')).send({ name: `Always ${suffix}` });

    const live = await auth(request(app).get('/banners?live=1'));
    const ids = live.body.rows.map((row) => row.id);
    expect(ids).toContain(now.body.banner.id);
    expect(ids).not.toContain(past.body.banner.id);
    expect(ids).not.toContain(future.body.banner.id);
  });
});

describe('menus', () => {
  it('adds items, nests them, and rejects a cycle', async () => {
    const parent = await auth(request(app).post(`/menus/${headerMenuId}/items`)).send({
      label: 'Shop',
      linkType: 'url',
      url: '/shop',
    });
    expect(parent.status).toBe(201);
    const parentId = parent.body.items[0].id;

    const child = await auth(request(app).post(`/menus/${headerMenuId}/items`)).send({
      label: 'Steaks',
      linkType: 'url',
      url: '/cats/steaks',
      parentId,
    });
    expect(child.body.items[0].children[0].label).toBe('Steaks');
    const childId = child.body.items[0].children[0].id;

    const cycle = await auth(request(app).patch(`/menu-items/${parentId}`)).send({ parentId: childId });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.code).toBe('CIRCULAR_PARENT');
  });

  it('requires a url for url links and a target for everything else', async () => {
    const noUrl = await auth(request(app).post(`/menus/${headerMenuId}/items`)).send({
      label: 'Broken',
      linkType: 'url',
    });
    expect(noUrl.status).toBe(400);

    const noTarget = await auth(request(app).post(`/menus/${headerMenuId}/items`)).send({
      label: 'Broken too',
      linkType: 'cat',
    });
    expect(noTarget.status).toBe(400);
  });

  it('refuses to delete an item that still has children', async () => {
    const parent = await auth(request(app).post(`/menus/${headerMenuId}/items`)).send({
      label: 'Parent',
      linkType: 'url',
      url: '/parent',
    });
    const parentId = parent.body.items.find((item) => item.label === 'Parent').id;
    await auth(request(app).post(`/menus/${headerMenuId}/items`)).send({
      label: 'Child',
      linkType: 'url',
      url: '/child',
      parentId,
    });

    const res = await auth(request(app).delete(`/menu-items/${parentId}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MENU_ITEM_HAS_CHILDREN');
  });

  it('reorders items in one call', async () => {
    const menu = (await auth(request(app).get('/menus'))).body.rows.find((row) => row.code === 'header');
    const before = (await auth(request(app).get(`/menus/${menu.id}/items`))).body.items;
    const reversed = [...before].reverse().map((item, index) => ({ id: item.id, position: index }));

    const res = await auth(request(app).post(`/menus/${menu.id}/items/reorder`)).send({ items: reversed });
    expect(res.status).toBe(200);
    expect(res.body.items.map((item) => item.id)).toEqual(reversed.map((item) => item.id));
  });
});
