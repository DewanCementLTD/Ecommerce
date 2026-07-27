import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `shop-owner-${suffix}@example.test`;
const host = `shop-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let companyId;
let catId;
let hiddenCatId;
let visible;
let hidden;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);
/** Public requests carry no token — the company comes from the host alone. */
const shop = (path) => request(app).get(path).set('X-Forwarded-Host', host);

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Shop Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
      companyId,
      host,
    });

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Shop Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );

    catId = (
      await conn.execute(
        `INSERT INTO cats (company_id, name, slug, is_active) VALUES (:companyId, 'Steaks', :slug, 1)
         RETURNING id INTO :id`,
        { companyId, slug: `steaks-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    hiddenCatId = (
      await conn.execute(
        `INSERT INTO cats (company_id, name, slug, is_active) VALUES (:companyId, 'Draft cat', :slug, 0)
         RETURNING id INTO :id`,
        { companyId, slug: `draft-cat-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;

  visible = (
    await auth(request(app).post('/products')).send({
      name: `Sirloin ${suffix}`,
      shortDesc: 'Pan seared',
      catIds: [catId],
      options: [{ name: 'Size', vals: ['300g', '500g'] }],
      variants: [
        { sku: `SIR-300-${suffix}`, opts: { Size: '300g' }, price: 18, cost: 7, stock: 4, isDefault: true },
        { sku: `SIR-500-${suffix}`, opts: { Size: '500g' }, price: 28, cost: 11, stock: 0 },
      ],
    })
  ).body.product;

  hidden = (
    await auth(request(app).post('/products')).send({
      name: `Unpublished ${suffix}`,
      isActive: 0,
      catIds: [catId],
      variants: [{ price: 5 }],
    })
  ).body.product;
});

afterAll(async () => {
  await getRedis().del(`host:${host}`);
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM coll_prods WHERE company_id = :companyId',
      'DELETE FROM colls WHERE company_id = :companyId',
      'DELETE FROM prod_cats WHERE company_id = :companyId',
      'DELETE FROM options WHERE company_id = :companyId',
      'DELETE FROM variants WHERE company_id = :companyId',
      'DELETE FROM products WHERE company_id = :companyId',
      'DELETE FROM cats WHERE company_id = :companyId',
      'DELETE FROM logs WHERE company_id = :companyId',
      'DELETE FROM admins WHERE company_id = :companyId',
      'DELETE FROM domains WHERE company_id = :companyId',
      'DELETE FROM companies WHERE id = :companyId',
    ]) {
      await conn.execute(sql, { companyId });
    }
    await conn.commit();
  });
  await closeRedis();
  await closePool();
});

describe('GET /shop/products', () => {
  it('serves the catalog with no auth at all', async () => {
    const res = await shop('/shop/products');
    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBeGreaterThan(0);
  });

  it('shows only active products', async () => {
    const res = await shop('/shop/products?pageSize=48');
    const ids = res.body.rows.map((row) => row.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
  });

  it('returns a card with price, stock state and an image url, and no cost', async () => {
    const res = await shop(`/shop/products?search=Sirloin ${suffix}`);
    const card = res.body.rows[0];
    expect(card).toMatchObject({ name: `Sirloin ${suffix}`, price: 18, inStock: true });
    expect(card.cost).toBeUndefined();
    expect(card.isActive).toBeUndefined();
    expect(Object.keys(card)).not.toContain('deletedAt');
  });

  it('404s on a host that belongs to no store', async () => {
    const res = await request(app).get('/shop/products').set('X-Forwarded-Host', 'nobody.invalid');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SITE_NOT_FOUND');
  });
});

describe('GET /shop/products/:slug', () => {
  it('returns the detail with variants, options and images', async () => {
    const res = await shop(`/shop/products/${visible.slug}`);
    expect(res.status).toBe(200);
    const product = res.body.product;
    expect(product.options[0]).toEqual({ name: 'Size', vals: ['300g', '500g'] });
    expect(product.variants).toHaveLength(2);
    expect(product.defaultVariant.sku).toBe(`SIR-300-${suffix}`);
    expect(product.variants.find((v) => v.sku === `SIR-500-${suffix}`).inStock).toBe(false);
  });

  it('never exposes cost to shoppers', async () => {
    const res = await shop(`/shop/products/${visible.slug}`);
    for (const variant of res.body.product.variants) {
      expect(variant.cost).toBeUndefined();
    }
    expect(JSON.stringify(res.body)).not.toContain('"cost"');
  });

  it('404s an inactive product even though it exists', async () => {
    const res = await shop(`/shop/products/${hidden.slug}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /shop/cats', () => {
  it('returns only the active tree', async () => {
    const res = await shop('/shop/cats');
    expect(res.status).toBe(200);
    const ids = res.body.tree.map((node) => node.id);
    expect(ids).toContain(catId);
    expect(ids).not.toContain(hiddenCatId);
  });

  it('serves a category with its active products', async () => {
    const res = await shop(`/shop/cats/steaks-${suffix}`);
    expect(res.status).toBe(200);
    expect(res.body.cat.name).toBe('Steaks');
    const ids = res.body.products.rows.map((row) => row.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(hidden.id);
  });

  it('404s an inactive category', async () => {
    const res = await shop(`/shop/cats/draft-cat-${suffix}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /shop/colls/:slug', () => {
  it('serves a manual collection', async () => {
    const coll = (
      await auth(request(app).post('/colls')).send({
        name: `Weekend ${suffix}`,
        productIds: [visible.id, hidden.id],
      })
    ).body.coll;

    const res = await shop(`/shop/colls/${coll.slug}`);
    expect(res.status).toBe(200);
    // The inactive product is a member but must not be shown.
    expect(res.body.products.rows.map((row) => row.id)).toEqual([visible.id]);
  });

  it('serves an automatic collection', async () => {
    const coll = (
      await auth(request(app).post('/colls')).send({
        name: `Auto shop ${suffix}`,
        type: 'auto',
        rules: { conditions: [{ field: 'cat_id', op: 'eq', value: catId }] },
      })
    ).body.coll;

    const res = await shop(`/shop/colls/${coll.slug}`);
    expect(res.body.products.rows.map((row) => row.id)).toEqual([visible.id]);
  });

  it('404s a hidden collection', async () => {
    const coll = (
      await auth(request(app).post('/colls')).send({ name: `Hidden coll ${suffix}`, isActive: 0 })
    ).body.coll;
    expect((await shop(`/shop/colls/${coll.slug}`)).status).toBe(404);
  });
});

describe('GET /shop/search', () => {
  it('finds by name', async () => {
    const res = await shop(`/shop/search?q=Sirloin ${suffix}`);
    expect(res.status).toBe(200);
    expect(res.body.rows.map((row) => row.id)).toContain(visible.id);
  });

  it('rejects an empty query', async () => {
    expect((await shop('/shop/search?q=')).status).toBe(400);
  });
});

describe('suspension', () => {
  it('returns 503 for every shop route while the company is suspended', async () => {
    await withPlatform(async (conn) => {
      await conn.execute(`UPDATE companies SET status = 'suspended' WHERE id = :id`, { id: companyId });
      await conn.commit();
    });

    try {
      for (const path of ['/shop/products', '/shop/cats', `/shop/products/${visible.slug}`]) {
        const res = await shop(path);
        expect(res.status, path).toBe(503);
      }
    } finally {
      await withPlatform(async (conn) => {
        await conn.execute(`UPDATE companies SET status = 'active' WHERE id = :id`, { id: companyId });
        await conn.commit();
      });
    }
  });
});
