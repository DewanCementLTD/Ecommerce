import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import sharp from 'sharp';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform, withCompany } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';
import * as productsRepo from '../../src/modules/products/products.repo.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `products-owner-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let companyId;
let catId;
let mediaIdA;
let mediaIdB;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

async function createProduct(body) {
  const res = await auth(request(app).post('/products')).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.product;
}

async function uploadImage(name) {
  const buffer = await sharp({
    create: { width: 60, height: 60, channels: 3, background: { r: 9, g: 9, b: 9 } },
  })
    .png()
    .toBuffer();
  const res = await auth(request(app).post('/media')).attach('file', buffer, name);
  expect(res.status).toBe(201);
  return res.body.media.ID;
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Products Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Products Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );

    catId = (
      await conn.execute(
        `INSERT INTO cats (company_id, name, slug) VALUES (:companyId, 'Grill', :slug)
         RETURNING id INTO :id`,
        { companyId, slug: `grill-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;
  mediaIdA = await uploadImage('a.png');
  mediaIdB = await uploadImage('b.png');
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM prod_imgs WHERE company_id = :companyId',
      'DELETE FROM prod_cats WHERE company_id = :companyId',
      'DELETE FROM coll_prods WHERE company_id = :companyId',
      'DELETE FROM options WHERE company_id = :companyId',
      'DELETE FROM variants WHERE company_id = :companyId',
      'DELETE FROM products WHERE company_id = :companyId',
      'DELETE FROM cats WHERE company_id = :companyId',
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

describe('POST /products', () => {
  it('creates a simple product with one implicit default variant', async () => {
    const product = await createProduct({ name: `Ribeye ${suffix}` });
    expect(product.slug).toBe(`ribeye-${suffix}`);
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].isDefault).toBe(1);
    expect(product.variants[0].price).toBe(0);
    expect(product.tags).toEqual([]);
  });

  it('creates a product with options, variants, tags and categories', async () => {
    const product = await createProduct({
      name: `Lamb Chops ${suffix}`,
      shortDesc: 'Grass fed',
      brand: 'Highland',
      tags: ['grill', 'lamb'],
      catIds: [catId],
      options: [{ name: 'Size', vals: ['500g', '1kg'] }],
      variants: [
        { sku: `LC-500-${suffix}`, opts: { Size: '500g' }, price: 12.5, stock: 4 },
        { sku: `LC-1000-${suffix}`, opts: { Size: '1kg' }, price: 22, stock: 2, isDefault: true },
      ],
    });

    expect(product.tags).toEqual(['grill', 'lamb']);
    expect(product.catIds).toEqual([catId]);
    expect(product.options[0].vals).toEqual(['500g', '1kg']);
    expect(product.variants).toHaveLength(2);
    expect(product.variants.find((v) => v.isDefault === 1).sku).toBe(`LC-1000-${suffix}`);
    expect(product.variants.find((v) => v.sku === `LC-500-${suffix}`).opts).toEqual({ Size: '500g' });
  });

  it('rejects a variant naming an option the product does not have', async () => {
    const res = await auth(request(app).post('/products')).send({
      name: `Bad opts ${suffix}`,
      options: [{ name: 'Size', vals: ['S'] }],
      variants: [{ opts: { Colour: 'Red' }, price: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_VARIANT_OPTION');
  });

  it('rejects a variant using a value the option does not offer', async () => {
    const res = await auth(request(app).post('/products')).send({
      name: `Bad value ${suffix}`,
      options: [{ name: 'Size', vals: ['S', 'M'] }],
      variants: [{ opts: { Size: 'XXL' }, price: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_VARIANT_OPTION_VALUE');
  });

  it('rejects two variants describing the same combination', async () => {
    const res = await auth(request(app).post('/products')).send({
      name: `Dup opts ${suffix}`,
      options: [{ name: 'Size', vals: ['S'] }],
      variants: [
        { opts: { Size: 'S' }, price: 1 },
        { opts: { Size: 'S' }, price: 2 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('DUPLICATE_VARIANT_OPTIONS');
  });

  it('rejects option values on a product with no options defined', async () => {
    const res = await auth(request(app).post('/products')).send({
      name: `No options ${suffix}`,
      variants: [{ opts: { Size: 'S' }, price: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OPTIONS_NOT_DEFINED');
  });

  it('rejects a category from outside this store and writes nothing', async () => {
    const res = await auth(request(app).post('/products')).send({
      name: `Bad cat ${suffix}`,
      catIds: [999_999_999],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CAT_NOT_FOUND');

    const list = await auth(request(app).get(`/products?search=Bad cat ${suffix}`));
    expect(list.body.rows).toHaveLength(0);
  });

  it('rejects a duplicate SKU with 409', async () => {
    const sku = `UNIQUE-${suffix}`;
    await createProduct({ name: `Sku one ${suffix}`, variants: [{ sku, price: 1 }] });
    const res = await auth(request(app).post('/products')).send({
      name: `Sku two ${suffix}`,
      variants: [{ sku, price: 1 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SKU_TAKEN');
  });

  it('writes an audit log entry', async () => {
    const product = await createProduct({ name: `Audited ${suffix}` });
    const logged = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `SELECT action FROM logs WHERE company_id = :companyId AND entity = 'product' AND entity_id = :id`,
        { companyId, id: product.id },
      );
      return result.rows.map((row) => row.ACTION);
    });
    expect(logged).toContain('product_created');
  });
});

describe('GET /products', () => {
  it('returns the default variant and primary image inline', async () => {
    const product = await createProduct({
      name: `Listed ${suffix}`,
      variants: [{ sku: `LS-${suffix}`, price: 9.5, stock: 3 }],
    });
    await auth(request(app).post(`/products/${product.id}/images`)).send({ mediaId: mediaIdA, alt: 'front' });

    const res = await auth(request(app).get(`/products?search=Listed ${suffix}`));
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r) => r.id === product.id);
    expect(row.defaultVariant).toMatchObject({ sku: `LS-${suffix}`, price: 9.5, stock: 3 });
    expect(row.primaryImage).toMatchObject({ mediaId: mediaIdA, alt: 'front' });
  });

  it('finds a product by its SKU', async () => {
    const product = await createProduct({
      name: `SkuSearch ${suffix}`,
      variants: [{ sku: `FINDME-${suffix}`, price: 1 }],
    });
    const res = await auth(request(app).get(`/products?search=findme-${suffix}`));
    expect(res.body.rows.map((r) => r.id)).toContain(product.id);
  });

  it('filters by category and by status', async () => {
    const inCat = await createProduct({ name: `In cat ${suffix}`, catIds: [catId] });
    const hidden = await createProduct({ name: `Hidden ${suffix}`, isActive: 0 });

    const byCat = await auth(request(app).get(`/products?catId=${catId}`));
    expect(byCat.body.rows.map((r) => r.id)).toContain(inCat.id);
    expect(byCat.body.rows.map((r) => r.id)).not.toContain(hidden.id);

    const active = await auth(request(app).get('/products?isActive=1&pageSize=100'));
    expect(active.body.rows.map((r) => r.id)).not.toContain(hidden.id);
  });

  it('sorts by price', async () => {
    const tag = `sorting-${suffix}`;
    const cheap = await createProduct({ name: `Cheap ${tag}`, variants: [{ price: 1 }] });
    const dear = await createProduct({ name: `Dear ${tag}`, variants: [{ price: 99 }] });

    const asc = await auth(request(app).get(`/products?search=${tag}&sort=price&dir=asc`));
    const ids = asc.body.rows.map((r) => r.id);
    expect(ids.indexOf(cheap.id)).toBeLessThan(ids.indexOf(dear.id));
  });

  it('paginates with a total', async () => {
    const res = await auth(request(app).get('/products?page=1&pageSize=2'));
    expect(res.body.rows.length).toBeLessThanOrEqual(2);
    expect(res.body.total).toBeGreaterThan(2);
    expect(res.body.page).toBe(1);
  });

  it('excludes soft-deleted products', async () => {
    const product = await createProduct({ name: `Gone ${suffix}` });
    await auth(request(app).delete(`/products/${product.id}`));
    const res = await auth(request(app).get(`/products?search=Gone ${suffix}`));
    expect(res.body.rows).toHaveLength(0);
  });

  it('costs the same number of queries for 24 products as for 3 (no N+1)', async () => {
    // Counts statements on the connection itself, so any per-row lookup the
    // service might add later shows up here as a growing number.
    const countStatements = async (pageSize) => {
      let executions = 0;
      await withCompany(companyId, async (conn) => {
        const wrapped = new Proxy(conn, {
          get(target, prop, receiver) {
            if (prop === 'execute') {
              return (...args) => {
                executions += 1;
                return target.execute(...args);
              };
            }
            return Reflect.get(target, prop, receiver);
          },
        });
        await productsRepo.listProducts(wrapped, {
          companyId,
          page: 1,
          pageSize,
          sort: 'created',
          dir: 'desc',
        });
      });
      return executions;
    };

    const forThree = await countStatements(3);
    const forTwentyFour = await countStatements(24);

    expect(forThree).toBe(forTwentyFour);
    expect(forTwentyFour).toBe(2); // one for the rows, one for the total
  });
});

describe('PATCH /products/:id', () => {
  it('updates fields and re-slugs on rename', async () => {
    const product = await createProduct({ name: `Old name ${suffix}` });
    const res = await auth(request(app).patch(`/products/${product.id}`)).send({
      name: `New name ${suffix}`,
      isFeatured: true,
      tags: ['featured'],
    });
    expect(res.status).toBe(200);
    expect(res.body.product.slug).toBe(`new-name-${suffix}`);
    expect(res.body.product.isFeatured).toBe(1);
    expect(res.body.product.tags).toEqual(['featured']);
  });

  it('replaces category links', async () => {
    const product = await createProduct({ name: `Recat ${suffix}`, catIds: [catId] });
    const res = await auth(request(app).patch(`/products/${product.id}`)).send({ catIds: [] });
    expect(res.body.product.catIds).toEqual([]);
  });

  it('404s for an unknown product', async () => {
    const res = await auth(request(app).patch('/products/999999999')).send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /products/bulk', () => {
  it('deactivates many and reports requested vs affected', async () => {
    const a = await createProduct({ name: `Bulk A ${suffix}` });
    const b = await createProduct({ name: `Bulk B ${suffix}` });

    const res = await auth(request(app).post('/products/bulk')).send({
      ids: [a.id, b.id, 999_999_999],
      action: 'deactivate',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ requested: 3, affected: 2 });

    const after = await auth(request(app).get(`/products/${a.id}`));
    expect(after.body.product.isActive).toBe(0);
  });

  it('bulk delete soft-deletes', async () => {
    const a = await createProduct({ name: `Bulk Del ${suffix}` });
    const res = await auth(request(app).post('/products/bulk')).send({ ids: [a.id], action: 'delete' });
    expect(res.body.affected).toBe(1);
    expect((await auth(request(app).get(`/products/${a.id}`))).status).toBe(404);

    const stillThere = await withPlatform(async (conn) => {
      const result = await conn.execute('SELECT deleted_at FROM products WHERE id = :id', { id: a.id });
      return result.rows[0].DELETED_AT;
    });
    expect(stillThere).not.toBeNull();
  });
});

describe('variants', () => {
  it('adds, updates, and re-defaults a variant', async () => {
    const product = await createProduct({
      name: `Variants ${suffix}`,
      options: [{ name: 'Cut', vals: ['Bone in', 'Boneless'] }],
      variants: [{ sku: `V1-${suffix}`, opts: { Cut: 'Bone in' }, price: 10 }],
    });

    const added = await auth(request(app).post(`/products/${product.id}/variants`)).send({
      sku: `V2-${suffix}`,
      opts: { Cut: 'Boneless' },
      price: 14,
      isDefault: true,
    });
    expect(added.status).toBe(201);
    const defaults = added.body.product.variants.filter((v) => v.isDefault === 1);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].sku).toBe(`V2-${suffix}`);

    const target = added.body.product.variants.find((v) => v.sku === `V1-${suffix}`);
    const patched = await auth(
      request(app).patch(`/products/${product.id}/variants/${target.id}`),
    ).send({ price: 11.25, salePrice: 9.99 });
    expect(patched.status).toBe(200);
    const updated = patched.body.product.variants.find((v) => v.id === target.id);
    expect(updated.price).toBe(11.25);
    expect(updated.salePrice).toBe(9.99);
  });

  it('refuses to delete the last variant', async () => {
    const product = await createProduct({ name: `Solo ${suffix}` });
    const res = await auth(
      request(app).delete(`/products/${product.id}/variants/${product.variants[0].id}`),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LAST_VARIANT');
  });

  it('promotes a survivor when the default variant is deleted', async () => {
    const product = await createProduct({
      name: `Promote ${suffix}`,
      variants: [
        { sku: `P1-${suffix}`, price: 5, isDefault: true },
        { sku: `P2-${suffix}`, price: 6 },
      ],
    });
    const defaultVariant = product.variants.find((v) => v.isDefault === 1);

    const res = await auth(
      request(app).delete(`/products/${product.id}/variants/${defaultVariant.id}`),
    );
    expect(res.status).toBe(200);
    expect(res.body.product.variants).toHaveLength(1);
    expect(res.body.product.variants[0].isDefault).toBe(1);
  });

  it("404s for a variant belonging to a different product", async () => {
    const one = await createProduct({ name: `Owner ${suffix}` });
    const two = await createProduct({ name: `Other ${suffix}` });
    const res = await auth(
      request(app).patch(`/products/${one.id}/variants/${two.variants[0].id}`),
    ).send({ price: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('VARIANT_NOT_FOUND');
  });
});

describe('stock adjustment', () => {
  it('applies a delta and records who changed it', async () => {
    const product = await createProduct({ name: `Stocked ${suffix}`, variants: [{ price: 3, stock: 10 }] });
    const variantId = product.variants[0].id;

    const res = await auth(
      request(app).post(`/products/${product.id}/variants/${variantId}/stock`),
    ).send({ delta: -4, reason: 'counted' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: 10, to: 6, delta: -4 });

    const meta = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `SELECT meta FROM logs WHERE company_id = :companyId AND action = 'stock_adjusted' AND entity_id = :id`,
        { companyId, id: variantId },
      );
      return JSON.parse(result.rows[0].META);
    });
    expect(meta).toMatchObject({ from: 10, to: 6, reason: 'counted' });
  });

  it('sets an absolute value', async () => {
    const product = await createProduct({ name: `Set stock ${suffix}`, variants: [{ price: 3, stock: 2 }] });
    const res = await auth(
      request(app).post(`/products/${product.id}/variants/${product.variants[0].id}/stock`),
    ).send({ set: 40 });
    expect(res.body.to).toBe(40);
  });

  it('refuses to go negative', async () => {
    const product = await createProduct({ name: `Neg stock ${suffix}`, variants: [{ price: 3, stock: 1 }] });
    const res = await auth(
      request(app).post(`/products/${product.id}/variants/${product.variants[0].id}/stock`),
    ).send({ delta: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('STOCK_NEGATIVE');
  });

  it('rejects both delta and set together', async () => {
    const product = await createProduct({ name: `Both ${suffix}` });
    const res = await auth(
      request(app).post(`/products/${product.id}/variants/${product.variants[0].id}/stock`),
    ).send({ delta: 1, set: 1 });
    expect(res.status).toBe(400);
  });
});

describe('images', () => {
  it('attaches, reorders and detaches images', async () => {
    const product = await createProduct({ name: `Gallery ${suffix}` });

    const first = await auth(request(app).post(`/products/${product.id}/images`)).send({
      mediaId: mediaIdA,
      alt: 'first',
    });
    expect(first.status).toBe(201);
    const second = await auth(request(app).post(`/products/${product.id}/images`)).send({
      mediaId: mediaIdB,
      alt: 'second',
    });
    expect(second.body.rows.map((r) => r.mediaId)).toEqual([mediaIdA, mediaIdB]);

    const [imgA, imgB] = second.body.rows;
    const reordered = await auth(request(app).post(`/products/${product.id}/images/reorder`)).send({
      items: [
        { id: imgB.id, position: 0 },
        { id: imgA.id, position: 1 },
      ],
    });
    expect(reordered.body.rows.map((r) => r.mediaId)).toEqual([mediaIdB, mediaIdA]);

    const listed = await auth(request(app).get(`/products?search=Gallery ${suffix}`));
    expect(listed.body.rows[0].primaryImage.mediaId).toBe(mediaIdB);

    const removed = await auth(request(app).delete(`/products/${product.id}/images/${imgB.id}`));
    expect(removed.body.rows.map((r) => r.mediaId)).toEqual([mediaIdA]);

    // Detaching leaves the media library untouched.
    const media = await auth(request(app).get(`/media/${mediaIdB}`));
    expect(media.status).toBe(200);
  });

  it('rejects an image that is not in this store', async () => {
    const product = await createProduct({ name: `Bad img ${suffix}` });
    const res = await auth(request(app).post(`/products/${product.id}/images`)).send({
      mediaId: 999_999_999,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_NOT_FOUND');
  });

  it('rejects attaching the same image twice', async () => {
    const product = await createProduct({ name: `Twice ${suffix}` });
    await auth(request(app).post(`/products/${product.id}/images`)).send({ mediaId: mediaIdA });
    const res = await auth(request(app).post(`/products/${product.id}/images`)).send({ mediaId: mediaIdA });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IMAGE_ALREADY_ATTACHED');
  });

  it("rejects reordering an image that is on another product", async () => {
    const one = await createProduct({ name: `Reorder one ${suffix}` });
    const two = await createProduct({ name: `Reorder two ${suffix}` });
    const attached = await auth(request(app).post(`/products/${two.id}/images`)).send({ mediaId: mediaIdA });

    const res = await auth(request(app).post(`/products/${one.id}/images/reorder`)).send({
      items: [{ id: attached.body.rows[0].id, position: 0 }],
    });
    expect(res.status).toBe(404);
  });
});

describe('PUT /products/:id/options', () => {
  it('replaces the option set and rejects one that strands a variant', async () => {
    const product = await createProduct({
      name: `Options swap ${suffix}`,
      options: [{ name: 'Size', vals: ['S', 'M'] }],
      variants: [{ opts: { Size: 'M' }, price: 4 }],
    });

    const bad = await auth(request(app).put(`/products/${product.id}/options`)).send({
      options: [{ name: 'Size', vals: ['S'] }],
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('UNKNOWN_VARIANT_OPTION_VALUE');

    // The rejected change must not have been written.
    const unchanged = await auth(request(app).get(`/products/${product.id}`));
    expect(unchanged.body.product.options[0].vals).toEqual(['S', 'M']);

    const good = await auth(request(app).put(`/products/${product.id}/options`)).send({
      options: [{ name: 'Size', vals: ['S', 'M', 'L'] }],
    });
    expect(good.status).toBe(200);
    expect(good.body.product.options[0].vals).toEqual(['S', 'M', 'L']);
  });
});
