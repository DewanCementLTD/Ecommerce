import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { deleteCompanies } from '../helpers/cleanup.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `i18n-owner-${suffix}@example.test`;
const host = `i18n-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let companyId;
let product;
let cat;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);
const shop = (path) => request(app).get(path).set('X-Forwarded-Host', host);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `I18n Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
      companyId,
      host,
    });
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'I18n Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );
    await conn.execute(
      `INSERT INTO langs (company_id, code, name, is_default, is_active)
       VALUES (:companyId, 'en', 'English', 1, 1)`,
      { companyId },
    );
    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;

  cat = (await auth(request(app).post('/cats')).send({ name: 'Fresh Meat' })).body.cat;
  product = (
    await auth(request(app).post('/products')).send({
      name: 'Ribeye Steak',
      shortDesc: 'Dry aged for 28 days',
      descr: 'A long English description.',
      catIds: [cat.id],
      variants: [{ price: 30, stock: 5 }],
    })
  ).body.product;
});

afterAll(async () => {
  await getRedis().del(`sf:host:${host}`);
  await withPlatform(async (conn) => {
    await conn.execute('DELETE FROM trans WHERE company_id = :id', { id: companyId });
    await deleteCompanies(conn, [companyId]);
  });
  await closeRedis();
  await closePool();
});

describe('languages', () => {
  it('lists the default language created with the store', async () => {
    const res = await auth(request(app).get('/langs'));
    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0]).toMatchObject({ code: 'en', isDefault: 1 });
  });

  it('adds Arabic', async () => {
    const res = await auth(request(app).post('/langs')).send({ code: 'ar', name: 'العربية' });
    expect(res.status).toBe(201);
    expect(res.body.lang).toMatchObject({ code: 'ar', isDefault: 0, isActive: 1 });
  });

  it('rejects a duplicate language', async () => {
    const res = await auth(request(app).post('/langs')).send({ code: 'ar', name: 'Arabic again' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LANG_EXISTS');
  });

  it('rejects a malformed code', async () => {
    expect((await auth(request(app).post('/langs')).send({ code: 'english!', name: 'x' })).status).toBe(400);
  });

  it('refuses to delete or deactivate the default language', async () => {
    const langs = (await auth(request(app).get('/langs'))).body.rows;
    const def = langs.find((row) => row.isDefault === 1);

    const del = await auth(request(app).delete(`/langs/${def.id}`));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('DEFAULT_LANG_PROTECTED');

    const off = await auth(request(app).patch(`/langs/${def.id}`)).send({ isActive: false });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('DEFAULT_LANG_ACTIVE');
  });

  it('moves the default to another language, leaving exactly one', async () => {
    const langs = (await auth(request(app).get('/langs'))).body.rows;
    const arabic = langs.find((row) => row.code === 'ar');

    const res = await auth(request(app).patch(`/langs/${arabic.id}`)).send({ isDefault: true });
    expect(res.status).toBe(200);

    const after = (await auth(request(app).get('/langs'))).body.rows;
    expect(after.filter((row) => row.isDefault === 1)).toHaveLength(1);
    expect(after.find((row) => row.isDefault === 1).code).toBe('ar');

    // Put English back as the default for the remaining tests.
    const english = after.find((row) => row.code === 'en');
    await auth(request(app).patch(`/langs/${english.id}`)).send({ isDefault: true });
  });
});

describe('translations', () => {
  it('stores and reads back a translation', async () => {
    const res = await auth(request(app).put(`/trans/product/${product.id}`)).send({
      lang: 'ar',
      fields: { name: 'ستيك ريب آي', shortDesc: 'معتق لمدة 28 يوما' },
    });
    expect(res.status).toBe(200);
    expect(res.body.translations.ar.name).toBe('ستيك ريب آي');
  });

  it('rejects a field that is not translatable', async () => {
    const res = await auth(request(app).put(`/trans/product/${product.id}`)).send({
      lang: 'ar',
      fields: { price: '99' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_FIELD');
  });

  it('rejects a language the store has not enabled', async () => {
    const res = await auth(request(app).put(`/trans/product/${product.id}`)).send({
      lang: 'fr',
      fields: { name: 'Faux-filet' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LANG_NOT_ENABLED');
  });

  it('rejects an entity that cannot be translated', async () => {
    expect((await auth(request(app).put(`/trans/variant/${product.id}`)).send({ lang: 'ar', fields: {} })).status).toBe(400);
  });

  it('clears a translation when the value is empty, restoring the fallback', async () => {
    await auth(request(app).put(`/trans/product/${product.id}`)).send({
      lang: 'ar',
      fields: { shortDesc: '' },
    });
    const res = await auth(request(app).get(`/trans/product/${product.id}`));
    expect(res.body.translations.ar.shortDesc).toBeUndefined();
    expect(res.body.translations.ar.name).toBe('ستيك ريب آي');
  });
});

describe('storefront reads in a language', () => {
  it('serves the default language when no lang is asked for', async () => {
    const res = await shop(`/shop/products/${product.slug}`);
    expect(res.body.product.name).toBe('Ribeye Steak');
  });

  it('serves the translated name and falls back per field', async () => {
    const res = await shop(`/shop/products/${product.slug}?lang=ar`);
    expect(res.status).toBe(200);
    // name is translated; shortDesc was cleared above, so it falls back to English
    expect(res.body.product.name).toBe('ستيك ريب آي');
    expect(res.body.product.shortDesc).toBe('Dry aged for 28 days');
    expect(res.body.product.descr).toBe('A long English description.');
  });

  it('translates the listing too', async () => {
    const res = await shop('/shop/products?lang=ar');
    expect(res.body.rows.find((row) => row.id === product.id).name).toBe('ستيك ريب آي');
  });

  it('translates the category tree', async () => {
    await auth(request(app).put(`/trans/cat/${cat.id}`)).send({
      lang: 'ar',
      fields: { name: 'لحوم طازجة' },
    });

    const res = await shop('/shop/cats?lang=ar');
    expect(res.body.tree.find((node) => node.id === cat.id).name).toBe('لحوم طازجة');

    const english = await shop('/shop/cats');
    expect(english.body.tree.find((node) => node.id === cat.id).name).toBe('Fresh Meat');
  });

  it('ignores an unknown language rather than erroring', async () => {
    const res = await shop(`/shop/products/${product.slug}?lang=zz`);
    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('Ribeye Steak');
  });

  it('lists the languages a shopper can switch to', async () => {
    const res = await shop('/shop/langs');
    expect(res.status).toBe(200);
    expect(res.body.langs.map((lang) => lang.code).sort()).toEqual(['ar', 'en']);
    expect(res.body.langs.find((lang) => lang.isDefault).code).toBe('en');
  });

  it('keeps the admin reading untranslated rows', async () => {
    const res = await auth(request(app).get(`/products/${product.id}`));
    expect(res.body.product.name).toBe('Ribeye Steak');
  });
});

describe('batching', () => {
  it('translates a whole page of products without a query per row', async () => {
    const ids = [];
    for (let n = 0; n < 6; n += 1) {
      const created = await auth(request(app).post('/products')).send({
        name: `Batch product ${n} ${suffix}`,
        variants: [{ price: 5 }],
      });
      ids.push(created.body.product.id);
      await auth(request(app).put(`/trans/product/${created.body.product.id}`)).send({
        lang: 'ar',
        fields: { name: `منتج ${n}` },
      });
    }

    const res = await shop('/shop/products?lang=ar&pageSize=48');
    const translated = res.body.rows.filter((row) => ids.includes(row.id));
    expect(translated).toHaveLength(6);
    for (const row of translated) {
      expect(row.name.startsWith('منتج')).toBe(true);
    }
  });
});

describe('deleting a language', () => {
  it('takes its translations with it', async () => {
    await auth(request(app).post('/langs')).send({ code: 'fr', name: 'Français' });
    await auth(request(app).put(`/trans/product/${product.id}`)).send({
      lang: 'fr',
      fields: { name: 'Faux-filet' },
    });

    const french = (await auth(request(app).get('/langs'))).body.rows.find((row) => row.code === 'fr');
    const res = await auth(request(app).delete(`/langs/${french.id}`));
    expect(res.status).toBe(200);
    expect(res.body.removedTranslations).toBe(1);

    const after = await auth(request(app).get(`/trans/product/${product.id}`));
    expect(after.body.translations.fr).toBeUndefined();
  });
});
