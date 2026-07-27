import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import oracledb from 'oracledb';
import { initPool, closePool, withCompany, withPlatform } from '../../src/db/pool.js';

/**
 * Database-level isolation for the eight tables added by 003_catalog.sql.
 *
 * None of the SQL in this file carries a company_id predicate of its own, so a
 * pass proves Oracle VPD is doing the filtering — not a repository WHERE clause,
 * and not an HTTP layer. This runs before any catalog endpoints exist, which is
 * the point: the policy is the floor everything else sits on.
 */

const suffix = Date.now();
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let companyAId;
let companyBId;
const a = {};

async function insertCompany(conn, name) {
  const result = await conn.execute(
    `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
    { name, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

beforeAll(async () => {
  await initPool();

  await withPlatform(async (conn) => {
    companyAId = await insertCompany(conn, `Iso Catalog Co A ${suffix}`);
    companyBId = await insertCompany(conn, `Iso Catalog Co B ${suffix}`);

    a.mediaId = (
      await conn.execute(
        `INSERT INTO media (company_id, filename, mime, size_bytes, storage_key)
         VALUES (:companyId, 'a.webp', 'image/webp', 1, :key) RETURNING id INTO :id`,
        { companyId: companyAId, key: `iso-catalog/${suffix}/a.webp`, id: OUT_ID },
      )
    ).outBinds.id[0];

    a.catId = (
      await conn.execute(
        `INSERT INTO cats (company_id, name, slug) VALUES (:companyId, 'A Cat', :slug)
         RETURNING id INTO :id`,
        { companyId: companyAId, slug: `a-cat-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    a.productId = (
      await conn.execute(
        `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'A Product', :slug)
         RETURNING id INTO :id`,
        { companyId: companyAId, slug: `a-product-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    a.variantId = (
      await conn.execute(
        `INSERT INTO variants (company_id, product_id, sku, price, stock, is_default)
         VALUES (:companyId, :productId, :sku, 9.99, 5, 1) RETURNING id INTO :id`,
        { companyId: companyAId, productId: a.productId, sku: `A-SKU-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    a.optionId = (
      await conn.execute(
        `INSERT INTO options (company_id, product_id, name, vals)
         VALUES (:companyId, :productId, 'Size', '["S","M"]') RETURNING id INTO :id`,
        { companyId: companyAId, productId: a.productId, id: OUT_ID },
      )
    ).outBinds.id[0];

    a.prodImgId = (
      await conn.execute(
        `INSERT INTO prod_imgs (company_id, product_id, media_id, position)
         VALUES (:companyId, :productId, :mediaId, 0) RETURNING id INTO :id`,
        { companyId: companyAId, productId: a.productId, mediaId: a.mediaId, id: OUT_ID },
      )
    ).outBinds.id[0];

    a.collId = (
      await conn.execute(
        `INSERT INTO colls (company_id, name, slug, type) VALUES (:companyId, 'A Coll', :slug, 'manual')
         RETURNING id INTO :id`,
        { companyId: companyAId, slug: `a-coll-${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute(
      'INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)',
      { companyId: companyAId, productId: a.productId, catId: a.catId },
    );
    await conn.execute(
      'INSERT INTO coll_prods (company_id, coll_id, product_id) VALUES (:companyId, :collId, :productId)',
      { companyId: companyAId, collId: a.collId, productId: a.productId },
    );

    await conn.commit();
  });
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM coll_prods WHERE company_id IN (:x, :y)',
      'DELETE FROM prod_cats WHERE company_id IN (:x, :y)',
      'DELETE FROM prod_imgs WHERE company_id IN (:x, :y)',
      'DELETE FROM options WHERE company_id IN (:x, :y)',
      'DELETE FROM variants WHERE company_id IN (:x, :y)',
      'DELETE FROM colls WHERE company_id IN (:x, :y)',
      'DELETE FROM products WHERE company_id IN (:x, :y)',
      'DELETE FROM cats WHERE company_id IN (:x, :y)',
      'DELETE FROM media WHERE company_id IN (:x, :y)',
      'DELETE FROM companies WHERE id IN (:x, :y)',
    ]) {
      await conn.execute(sql, { x: companyAId, y: companyBId });
    }
    await conn.commit();
  });

  await closePool();
});

/**
 * One entry per company-owned table in 003_catalog.sql. `where` never mentions
 * company_id, and `insert` deliberately names company A while running under
 * company B's context.
 *
 * Bind values are functions, not literals: vitest builds the describe blocks
 * before beforeAll runs, so reading `a.*` eagerly here would bind undefined —
 * which would make the "B sees nothing" assertions pass for the wrong reason.
 */
const CASES = [
  {
    table: 'cats',
    where: 'id = :id',
    binds: () => ({ id: a.catId }),
    set: "name = 'hijacked'",
    insert: `INSERT INTO cats (company_id, name, slug) VALUES (:companyId, 'X', 'x-cats')`,
    insertBinds: () => ({}),
  },
  {
    table: 'products',
    where: 'id = :id',
    binds: () => ({ id: a.productId }),
    set: "name = 'hijacked'",
    insert: `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'X', 'x-products')`,
    insertBinds: () => ({}),
  },
  {
    table: 'variants',
    where: 'id = :id',
    binds: () => ({ id: a.variantId }),
    set: 'price = 0.01',
    insert: `INSERT INTO variants (company_id, product_id, price) VALUES (:companyId, :productId, 1)`,
    insertBinds: () => ({ productId: a.productId }),
  },
  {
    table: 'options',
    where: 'id = :id',
    binds: () => ({ id: a.optionId }),
    set: "name = 'hijacked'",
    insert: `INSERT INTO options (company_id, product_id, name) VALUES (:companyId, :productId, 'X')`,
    insertBinds: () => ({ productId: a.productId }),
  },
  {
    table: 'prod_imgs',
    where: 'id = :id',
    binds: () => ({ id: a.prodImgId }),
    set: "alt = 'hijacked'",
    insert: `INSERT INTO prod_imgs (company_id, product_id, media_id) VALUES (:companyId, :productId, :mediaId)`,
    insertBinds: () => ({ productId: a.productId, mediaId: a.mediaId }),
  },
  {
    table: 'prod_cats',
    where: 'product_id = :productId',
    binds: () => ({ productId: a.productId }),
    set: 'cat_id = cat_id',
    insert: `INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)`,
    insertBinds: () => ({ productId: a.productId, catId: a.catId }),
  },
  {
    table: 'colls',
    where: 'id = :id',
    binds: () => ({ id: a.collId }),
    set: "name = 'hijacked'",
    insert: `INSERT INTO colls (company_id, name, slug) VALUES (:companyId, 'X', 'x-colls')`,
    insertBinds: () => ({}),
  },
  {
    table: 'coll_prods',
    where: 'product_id = :productId',
    binds: () => ({ productId: a.productId }),
    set: 'position = 99',
    insert: `INSERT INTO coll_prods (company_id, coll_id, product_id) VALUES (:companyId, :collId, :productId)`,
    insertBinds: () => ({ collId: a.collId, productId: a.productId }),
  },
];

describe('003_catalog.sql: VPD enforcement per table (release gate)', () => {
  it('every new table carries an enabled policy with update_check', async () => {
    const rows = await withPlatform(async (conn) => {
      const result = await conn.execute(
        `SELECT object_name, sel, ins, upd, del, chk_option
           FROM all_policies
          WHERE object_owner = UPPER(:owner)
            AND object_name IN ('CATS','PRODUCTS','VARIANTS','OPTIONS','PROD_IMGS','PROD_CATS','COLLS','COLL_PRODS')`,
        { owner: process.env.DB_USER },
      );
      return result.rows;
    });

    expect(rows.length).toBe(8);
    for (const row of rows) {
      expect(
        [row.SEL, row.INS, row.UPD, row.DEL, row.CHK_OPTION],
        `policy on ${row.OBJECT_NAME}`,
      ).toEqual(['YES', 'YES', 'YES', 'YES', 'YES']);
    }
  });

  for (const c of CASES) {
    describe(c.table, () => {
      it("A's row is visible under A's own context", async () => {
        const rows = await withCompany(companyAId, async (conn) => {
          const result = await conn.execute(`SELECT company_id FROM ${c.table} WHERE ${c.where}`, c.binds());
          return result.rows;
        });
        expect(rows.length).toBeGreaterThan(0);
      });

      it("SELECT under B's context returns none of A's rows", async () => {
        const rows = await withCompany(companyBId, async (conn) => {
          const result = await conn.execute(`SELECT company_id FROM ${c.table} WHERE ${c.where}`, c.binds());
          return result.rows;
        });
        expect(rows.length).toBe(0);
      });

      it("UPDATE under B's context touches none of A's rows", async () => {
        const affected = await withCompany(companyBId, async (conn) => {
          const result = await conn.execute(`UPDATE ${c.table} SET ${c.set} WHERE ${c.where}`, c.binds());
          await conn.rollback();
          return result.rowsAffected;
        });
        expect(affected).toBe(0);
      });

      it("DELETE under B's context removes none of A's rows", async () => {
        const affected = await withCompany(companyBId, async (conn) => {
          const result = await conn.execute(`DELETE FROM ${c.table} WHERE ${c.where}`, c.binds());
          await conn.rollback();
          return result.rowsAffected;
        });
        expect(affected).toBe(0);
      });

      it("INSERT of a row stamped with A's company_id is rejected under B's context", async () => {
        await expect(
          withCompany(companyBId, async (conn) => {
            await conn.execute(c.insert, { companyId: companyAId, ...c.insertBinds() });
            await conn.rollback();
          }),
        ).rejects.toThrow(/ORA-28115|ORA-02291/);
      });
    });
  }
});

describe('003_catalog.sql: composite FKs close the cross-company parent hole', () => {
  // Integrity constraints are checked by the Oracle kernel and are NOT subject to
  // VPD, so a plain product_id FK would accept another company's product id. The
  // FKs reference (company_id, id), which makes that impossible.
  it("B cannot attach a variant to A's product even with its own company_id", async () => {
    await expect(
      withCompany(companyBId, async (conn) => {
        await conn.execute(
          'INSERT INTO variants (company_id, product_id, price) VALUES (:companyId, :productId, 1)',
          { companyId: companyBId, productId: a.productId },
        );
        await conn.rollback();
      }),
    ).rejects.toThrow(/ORA-02291/);
  });

  it("B cannot file its own product under A's category", async () => {
    const productBId = await withCompany(companyBId, async (conn) => {
      const result = await conn.execute(
        `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'B Product', :slug)
         RETURNING id INTO :id`,
        { companyId: companyBId, slug: `b-product-${suffix}`, id: OUT_ID },
      );
      await conn.commit();
      return result.outBinds.id[0];
    });

    await expect(
      withCompany(companyBId, async (conn) => {
        await conn.execute(
          'INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)',
          { companyId: companyBId, productId: productBId, catId: a.catId },
        );
        await conn.rollback();
      }),
    ).rejects.toThrow(/ORA-02291/);
  });

  it("B cannot point a product image at A's media", async () => {
    await expect(
      withCompany(companyBId, async (conn) => {
        const product = await conn.execute(
          `SELECT id FROM products WHERE slug = :slug`,
          { slug: `b-product-${suffix}` },
        );
        await conn.execute(
          'INSERT INTO prod_imgs (company_id, product_id, media_id) VALUES (:companyId, :productId, :mediaId)',
          { companyId: companyBId, productId: product.rows[0].ID, mediaId: a.mediaId },
        );
        await conn.rollback();
      }),
    ).rejects.toThrow(/ORA-02291/);
  });
});
