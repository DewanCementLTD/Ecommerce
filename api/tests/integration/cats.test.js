import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `cats-owner-${suffix}@example.test`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let app;
let token;
let companyId;

const auth = (req) => req.set('Authorization', `Bearer ${token}`);

async function createCat(body) {
  const res = await auth(request(app).post('/cats')).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.cat;
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
        { name: `Cats Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Cats Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );

    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM prod_cats WHERE company_id = :companyId',
      'DELETE FROM products WHERE company_id = :companyId',
      'DELETE FROM cats WHERE company_id = :companyId',
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

describe('POST /cats', () => {
  it('creates a category and derives the slug from the name', async () => {
    const cat = await createCat({ name: `Fresh Meat ${suffix}` });
    expect(cat.slug).toBe(`fresh-meat-${suffix}`);
    expect(cat.isActive).toBe(1);
    expect(cat.parentId).toBeNull();
  });

  it('suffixes the slug rather than colliding when the name repeats', async () => {
    const first = await createCat({ name: `Poultry ${suffix}` });
    const second = await createCat({ name: `Poultry ${suffix}` });
    expect(second.slug).toBe(`${first.slug}-2`);

    const third = await createCat({ name: `Poultry ${suffix}` });
    expect(third.slug).toBe(`${first.slug}-3`);
  });

  it('accepts a manual slug override', async () => {
    const cat = await createCat({ name: `Lamb ${suffix}`, slug: `custom-lamb-${suffix}` });
    expect(cat.slug).toBe(`custom-lamb-${suffix}`);
  });

  it('falls back to a usable slug for a name with no latin characters', async () => {
    const cat = await createCat({ name: 'لحم بقري' });
    expect(cat.slug).toMatch(/^item(-\d+)?$/);
  });

  it('rejects an invalid manual slug with 400', async () => {
    const res = await auth(request(app).post('/cats')).send({ name: 'Bad slug', slug: 'Not A Slug' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a missing name with 400', async () => {
    const res = await auth(request(app).post('/cats')).send({});
    expect(res.status).toBe(400);
  });

  it('rejects an image id that does not exist in this store with 400', async () => {
    const res = await auth(request(app).post('/cats')).send({ name: `Bad image ${suffix}`, imageId: 999_999_999 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_NOT_FOUND');
  });

  it('rejects a parent that does not exist with 400', async () => {
    const res = await auth(request(app).post('/cats')).send({
      name: `Orphan ${suffix}`,
      parentId: 999_999_999,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PARENT_NOT_FOUND');
  });
});

describe('GET /cats/tree', () => {
  it('nests children under their parent, ordered by position', async () => {
    const parent = await createCat({ name: `Beef ${suffix}`, position: 0 });
    const second = await createCat({ name: `Ribs ${suffix}`, parentId: parent.id, position: 1 });
    const first = await createCat({ name: `Steaks ${suffix}`, parentId: parent.id, position: 0 });

    const res = await auth(request(app).get('/cats/tree'));
    expect(res.status).toBe(200);

    const node = res.body.tree.find((row) => row.id === parent.id);
    expect(node.children.map((child) => child.id)).toEqual([first.id, second.id]);
  });

  it('filters to active categories when asked', async () => {
    const hidden = await createCat({ name: `Hidden ${suffix}`, isActive: 0 });
    const res = await auth(request(app).get('/cats/tree?isActive=1'));
    const ids = res.body.tree.map((row) => row.id);
    expect(ids).not.toContain(hidden.id);
  });
});

describe('GET /cats and GET /cats/:id', () => {
  it('searches by name', async () => {
    const cat = await createCat({ name: `Sausages ${suffix}` });
    const res = await auth(request(app).get(`/cats?search=sausages`));
    expect(res.status).toBe(200);
    expect(res.body.rows.map((row) => row.id)).toContain(cat.id);
  });

  it('reports child and product counts so a delete can be confirmed accurately', async () => {
    const parent = await createCat({ name: `Counted ${suffix}` });
    await createCat({ name: `Counted child ${suffix}`, parentId: parent.id });

    const productId = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'Linked', :slug)
         RETURNING id INTO :id`,
        { companyId, slug: `linked-${suffix}`, id: OUT_ID },
      );
      const id = result.outBinds.id[0];
      await conn.execute(
        'INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)',
        { companyId, productId: id, catId: parent.id },
      );
      await conn.commit();
      return id;
    });
    expect(productId).toBeGreaterThan(0);

    const res = await auth(request(app).get(`/cats/${parent.id}`));
    expect(res.status).toBe(200);
    expect(res.body.cat.childCount).toBe(1);
    expect(res.body.cat.productCount).toBe(1);
  });

  it('404s for an unknown id', async () => {
    const res = await auth(request(app).get('/cats/999999999'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CAT_NOT_FOUND');
  });
});

describe('PATCH /cats/:id', () => {
  it('renames and re-slugs, keeping the slug unique', async () => {
    const cat = await createCat({ name: `Before ${suffix}` });
    const res = await auth(request(app).patch(`/cats/${cat.id}`)).send({ name: `After ${suffix}` });
    expect(res.status).toBe(200);
    expect(res.body.cat.name).toBe(`After ${suffix}`);
    expect(res.body.cat.slug).toBe(`after-${suffix}`);
  });

  it('keeps its own slug when renaming to the same name', async () => {
    const cat = await createCat({ name: `Stable ${suffix}` });
    const res = await auth(request(app).patch(`/cats/${cat.id}`)).send({ name: `Stable ${suffix}` });
    expect(res.body.cat.slug).toBe(cat.slug);
  });

  it('moves a category to top level with an explicit null parent', async () => {
    const parent = await createCat({ name: `Mover parent ${suffix}` });
    const child = await createCat({ name: `Mover child ${suffix}`, parentId: parent.id });

    const res = await auth(request(app).patch(`/cats/${child.id}`)).send({ parentId: null });
    expect(res.status).toBe(200);
    expect(res.body.cat.parentId).toBeNull();
  });

  it('refuses to make a category its own parent', async () => {
    const cat = await createCat({ name: `Selfish ${suffix}` });
    const res = await auth(request(app).patch(`/cats/${cat.id}`)).send({ parentId: cat.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CIRCULAR_PARENT');
  });

  it('refuses to move a category inside its own descendant', async () => {
    const grandparent = await createCat({ name: `GP ${suffix}` });
    const parent = await createCat({ name: `P ${suffix}`, parentId: grandparent.id });
    const child = await createCat({ name: `C ${suffix}`, parentId: parent.id });

    const res = await auth(request(app).patch(`/cats/${grandparent.id}`)).send({ parentId: child.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CIRCULAR_PARENT');
  });

  it('rejects an empty body with 400', async () => {
    const cat = await createCat({ name: `Empty patch ${suffix}` });
    const res = await auth(request(app).patch(`/cats/${cat.id}`)).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /cats/reorder', () => {
  it('applies positions and re-parenting in one call', async () => {
    const a = await createCat({ name: `R-A ${suffix}`, position: 0 });
    const b = await createCat({ name: `R-B ${suffix}`, position: 1 });
    const c = await createCat({ name: `R-C ${suffix}`, position: 2 });

    const res = await auth(request(app).post('/cats/reorder')).send({
      items: [
        { id: c.id, position: 0 },
        { id: b.id, position: 1, parentId: c.id },
        { id: a.id, position: 2 },
      ],
    });
    expect(res.status).toBe(200);

    const cNode = res.body.tree.find((row) => row.id === c.id);
    expect(cNode.position).toBe(0);
    expect(cNode.children.map((child) => child.id)).toEqual([b.id]);
  });

  it('rejects the whole batch when one id belongs to nobody', async () => {
    const a = await createCat({ name: `R-D ${suffix}`, position: 5 });
    const res = await auth(request(app).post('/cats/reorder')).send({
      items: [
        { id: a.id, position: 9 },
        { id: 999_999_999, position: 0 },
      ],
    });
    expect(res.status).toBe(404);

    const after = await auth(request(app).get(`/cats/${a.id}`));
    expect(after.body.cat.position).toBe(5);
  });

  it('rejects a batch that would create a cycle, leaving positions untouched', async () => {
    const parent = await createCat({ name: `Cyc-P ${suffix}`, position: 0 });
    const child = await createCat({ name: `Cyc-C ${suffix}`, parentId: parent.id, position: 0 });

    const res = await auth(request(app).post('/cats/reorder')).send({
      items: [
        { id: parent.id, position: 3, parentId: child.id },
        { id: child.id, position: 0, parentId: parent.id },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('CIRCULAR_PARENT');

    const after = await auth(request(app).get(`/cats/${parent.id}`));
    expect(after.body.cat.position).toBe(0);
  });

  it('rejects a duplicated id in the payload', async () => {
    const a = await createCat({ name: `Dup ${suffix}` });
    const res = await auth(request(app).post('/cats/reorder')).send({
      items: [
        { id: a.id, position: 0 },
        { id: a.id, position: 1 },
      ],
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /cats/:id', () => {
  it('refuses while subcategories exist, naming how many', async () => {
    const parent = await createCat({ name: `Del-P ${suffix}` });
    await createCat({ name: `Del-C ${suffix}`, parentId: parent.id });

    const res = await auth(request(app).delete(`/cats/${parent.id}`));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CAT_HAS_CHILDREN');
    expect(res.body.error.message).toContain('1 subcategory');
  });

  it('deletes a leaf, unlinks its products, and reports the count', async () => {
    const cat = await createCat({ name: `Del-Leaf ${suffix}` });

    await withPlatform(async (conn) => {
      const product = await conn.execute(
        `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'Unlinked', :slug)
         RETURNING id INTO :id`,
        { companyId, slug: `unlinked-${suffix}`, id: OUT_ID },
      );
      await conn.execute(
        'INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)',
        { companyId, productId: product.outBinds.id[0], catId: cat.id },
      );
      await conn.commit();
    });

    const res = await auth(request(app).delete(`/cats/${cat.id}`));
    expect(res.status).toBe(200);
    expect(res.body.unlinkedProducts).toBe(1);

    expect((await auth(request(app).get(`/cats/${cat.id}`))).status).toBe(404);

    const productSurvived = await withPlatform(async (conn) => {
      const result = await conn.execute('SELECT COUNT(*) AS cnt FROM products WHERE slug = :slug', {
        slug: `unlinked-${suffix}`,
      });
      return result.rows[0].CNT;
    });
    expect(productSurvived).toBe(1);
  });

  it('404s for an unknown id', async () => {
    const res = await auth(request(app).delete('/cats/999999999'));
    expect(res.status).toBe(404);
  });
});

describe('auth', () => {
  it('rejects an unauthenticated request', async () => {
    const res = await request(app).get('/cats');
    expect(res.status).toBe(401);
  });
});
