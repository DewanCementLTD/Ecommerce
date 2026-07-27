import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import oracledb from 'oracledb';
import { initPool, closePool, withCompany, withPlatform } from '../../src/db/pool.js';

/**
 * The data invariants 003_catalog.sql promises, asserted against the real
 * database rather than assumed. Every catalog module built on top of this
 * relies on them: one default variant per product, per-company slugs, and JSON
 * columns that actually reject non-JSON.
 */

const suffix = Date.now();
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

let companyId;
let otherCompanyId;
let productId;

beforeAll(async () => {
  await initPool();

  await withPlatform(async (conn) => {
    const mk = async (name) =>
      (
        await conn.execute(
          `INSERT INTO companies (name, status) VALUES (:name, 'active') RETURNING id INTO :id`,
          { name, id: OUT_ID },
        )
      ).outBinds.id[0];
    companyId = await mk(`Catalog Schema Co ${suffix}`);
    otherCompanyId = await mk(`Catalog Schema Other Co ${suffix}`);
    await conn.commit();
  });

  productId = await withCompany(companyId, async (conn) => {
    const result = await conn.execute(
      `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'Ribeye', :slug)
       RETURNING id INTO :id`,
      { companyId, slug: `ribeye-${suffix}`, id: OUT_ID },
    );
    await conn.commit();
    return result.outBinds.id[0];
  });
});

afterAll(async () => {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM variants WHERE company_id IN (:x, :y)',
      'DELETE FROM products WHERE company_id IN (:x, :y)',
      'DELETE FROM companies WHERE id IN (:x, :y)',
    ]) {
      await conn.execute(sql, { x: companyId, y: otherCompanyId });
    }
    await conn.commit();
  });
  await closePool();
});

describe('catalog schema invariants', () => {
  it('allows only one default variant per product', async () => {
    await withCompany(companyId, async (conn) => {
      await conn.execute(
        `INSERT INTO variants (company_id, product_id, sku, price, is_default)
         VALUES (:companyId, :productId, :sku, 25.00, 1)`,
        { companyId, productId, sku: `RIB-1-${suffix}` },
      );
      await conn.commit();
    });

    await expect(
      withCompany(companyId, async (conn) => {
        await conn.execute(
          `INSERT INTO variants (company_id, product_id, sku, price, is_default)
           VALUES (:companyId, :productId, :sku, 30.00, 1)`,
          { companyId, productId, sku: `RIB-2-${suffix}` },
        );
        await conn.commit();
      }),
    ).rejects.toThrow(/ORA-00001/);
  });

  it('allows many non-default variants on the same product', async () => {
    const inserted = await withCompany(companyId, async (conn) => {
      for (const n of [2, 3]) {
        await conn.execute(
          `INSERT INTO variants (company_id, product_id, sku, price, is_default)
           VALUES (:companyId, :productId, :sku, 30.00, 0)`,
          { companyId, productId, sku: `RIB-${n}-${suffix}` },
        );
      }
      await conn.commit();
      const result = await conn.execute(
        'SELECT COUNT(*) AS cnt FROM variants WHERE company_id = :companyId AND product_id = :productId',
        { companyId, productId },
      );
      return result.rows[0].CNT;
    });
    expect(inserted).toBe(3);
  });

  it('rejects a duplicate slug within a company but allows it across companies', async () => {
    await expect(
      withCompany(companyId, async (conn) => {
        await conn.execute(
          `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'Ribeye again', :slug)`,
          { companyId, slug: `ribeye-${suffix}` },
        );
        await conn.commit();
      }),
    ).rejects.toThrow(/ORA-00001/);

    const otherId = await withCompany(otherCompanyId, async (conn) => {
      const result = await conn.execute(
        `INSERT INTO products (company_id, name, slug) VALUES (:companyId, 'Ribeye', :slug)
         RETURNING id INTO :id`,
        { companyId: otherCompanyId, slug: `ribeye-${suffix}`, id: OUT_ID },
      );
      await conn.commit();
      return result.outBinds.id[0];
    });
    expect(otherId).toBeGreaterThan(0);
  });

  it('rejects a non-JSON tags value and accepts a JSON array', async () => {
    await expect(
      withCompany(companyId, async (conn) => {
        await conn.execute(
          `INSERT INTO products (company_id, name, slug, tags) VALUES (:companyId, 'Bad tags', :slug, 'not json')`,
          { companyId, slug: `bad-tags-${suffix}` },
        );
        await conn.commit();
      }),
    ).rejects.toThrow(/ORA-02290/);

    const tags = await withCompany(companyId, async (conn) => {
      await conn.execute(
        `INSERT INTO products (company_id, name, slug, tags)
         VALUES (:companyId, 'Good tags', :slug, '["grill","beef"]')`,
        { companyId, slug: `good-tags-${suffix}` },
      );
      await conn.commit();
      const result = await conn.execute('SELECT tags FROM products WHERE slug = :slug', {
        slug: `good-tags-${suffix}`,
      });
      return result.rows[0].TAGS;
    });
    // fetchAsString on CLOBs (set in pool.js) means this is already a string.
    expect(JSON.parse(tags)).toEqual(['grill', 'beef']);
  });

  it('rejects a negative price', async () => {
    await expect(
      withCompany(companyId, async (conn) => {
        await conn.execute(
          `INSERT INTO variants (company_id, product_id, sku, price) VALUES (:companyId, :productId, :sku, -1)`,
          { companyId, productId, sku: `RIB-NEG-${suffix}` },
        );
        await conn.commit();
      }),
    ).rejects.toThrow(/ORA-02290/);
  });
});
