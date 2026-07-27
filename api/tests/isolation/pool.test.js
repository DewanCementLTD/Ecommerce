import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initPool, closePool, withCompany, withPlatform, getPool } from '../../src/db/pool.js';

beforeAll(async () => {
  await initPool({ poolMin: 1, poolMax: 1 });
});

afterAll(async () => {
  await closePool();
});

async function readCompanyContext(conn) {
  const result = await conn.execute(
    `SELECT SYS_CONTEXT('sf_ctx','company_id') AS company_id FROM dual`,
  );
  return result.rows[0].COMPANY_ID;
}

describe('withCompany', () => {
  it('refuses to run when companyId is null or undefined', async () => {
    await expect(withCompany(null, async () => {})).rejects.toThrow();
    await expect(withCompany(undefined, async () => {})).rejects.toThrow();
  });

  it('sets context correctly inside the callback', async () => {
    let seen;
    await withCompany(42, async (conn) => {
      seen = await readCompanyContext(conn);
    });
    expect(seen).toBe('42');
  });

  it('clears context after a normal return', async () => {
    await withCompany(42, async () => {});

    const conn = await getPool().getConnection();
    try {
      expect(await readCompanyContext(conn)).toBeNull();
    } finally {
      await conn.close();
    }
  });

  it('clears context after the callback throws', async () => {
    await expect(
      withCompany(42, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const conn = await getPool().getConnection();
    try {
      expect(await readCompanyContext(conn)).toBeNull();
    } finally {
      await conn.close();
    }
  });

  it('never leaks context between two sequential calls with different ids', async () => {
    let seenInFirst;
    await withCompany(1, async (conn) => {
      seenInFirst = await readCompanyContext(conn);
    });

    let seenInSecond;
    await withCompany(2, async (conn) => {
      seenInSecond = await readCompanyContext(conn);
    });

    expect(seenInFirst).toBe('1');
    expect(seenInSecond).toBe('2');
  });
});

describe('withPlatform', () => {
  it('bypasses VPD while withCompany stays scoped to its own company', async () => {
    await withPlatform(async (conn) => {
      await conn.execute(`INSERT INTO companies (name, status) VALUES ('pool-test-co', 'active')`);
      await conn.commit();
    });

    const owner = await withPlatform(async (conn) => {
      const result = await conn.execute(`SELECT id FROM companies WHERE name = 'pool-test-co'`);
      return result.rows[0].ID;
    });

    try {
      await withCompany(owner, async (conn) => {
        await conn.execute(
          `INSERT INTO settings (company_id, key, value) VALUES (:companyId, 'test_key', 'test_value')`,
          { companyId: owner },
        );
        await conn.commit();
      });

      const countAsOwner = await withCompany(owner, async (conn) => {
        const result = await conn.execute('SELECT COUNT(*) AS cnt FROM settings WHERE company_id = :companyId', {
          companyId: owner,
        });
        return result.rows[0].CNT;
      });
      expect(countAsOwner).toBe(1);

      const countAsOther = await withCompany(owner + 1_000_000, async (conn) => {
        const result = await conn.execute('SELECT COUNT(*) AS cnt FROM settings WHERE company_id = :companyId', {
          companyId: owner,
        });
        return result.rows[0].CNT;
      });
      expect(countAsOther).toBe(0);

      const countViaPlatform = await withPlatform(async (conn) => {
        const result = await conn.execute('SELECT COUNT(*) AS cnt FROM settings WHERE company_id = :companyId', {
          companyId: owner,
        });
        return result.rows[0].CNT;
      });
      expect(countViaPlatform).toBe(1);
    } finally {
      await withPlatform(async (conn) => {
        await conn.execute('DELETE FROM settings WHERE company_id = :companyId', { companyId: owner });
        await conn.execute('DELETE FROM companies WHERE id = :id', { id: owner });
        await conn.commit();
      });
    }
  });
});
