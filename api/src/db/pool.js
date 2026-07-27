import oracledb from 'oracledb';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool;
let platformPool;

/**
 * @param {{ poolMin?: number, poolMax?: number }} [overrides] test hook to force a single-connection pool
 */
export async function initPool(overrides = {}) {
  pool = await oracledb.createPool({
    user: env.db.user,
    password: env.db.password,
    connectString: env.db.dsn,
    poolMin: overrides.poolMin ?? env.db.poolMin,
    poolMax: overrides.poolMax ?? env.db.poolMax,
    poolAlias: 'company',
  });

  platformPool = await oracledb.createPool({
    user: env.db.platformUser,
    password: env.db.platformPassword,
    connectString: env.db.dsn,
    poolMin: overrides.poolMin ?? 1,
    poolMax: overrides.poolMax ?? 4,
    poolAlias: 'platform',
  });
}

export function getPool() {
  return pool;
}

export function getPlatformPool() {
  return platformPool;
}

/**
 * The only sanctioned way for app code to run a company-scoped query.
 * Sets the sf_ctx.company_id application context on borrow, always clears it
 * on release — including when fn throws — so pooled connections can never
 * leak context between requests.
 * @param {number} companyId
 * @param {(conn: oracledb.Connection) => Promise<any>} fn
 * @param {{ reqId?: string }} [meta]
 */
export async function withCompany(companyId, fn, meta = {}) {
  if (companyId === null || companyId === undefined) {
    throw new Error('withCompany requires a companyId');
  }

  const conn = await pool.getConnection();
  logger.debug({ reqId: meta.reqId, companyId }, 'db connection borrowed');
  try {
    await conn.execute('BEGIN sf_sec.set_company(:companyId); END;', { companyId });
    return await fn(conn);
  } finally {
    try {
      await conn.execute('BEGIN sf_sec.clear_company; END;');
    } finally {
      await conn.close();
      logger.debug({ reqId: meta.reqId, companyId }, 'db connection released');
    }
  }
}

/**
 * Super Admin cross-company access. Uses a separate DB user (ecomm_platform)
 * granted EXEMPT ACCESS POLICY, so it bypasses VPD entirely — never scoped by
 * sf_ctx, never subject to company_predicate.
 * @param {(conn: oracledb.Connection) => Promise<any>} fn
 * @param {{ reqId?: string }} [meta]
 */
export async function withPlatform(fn, meta = {}) {
  const conn = await platformPool.getConnection();
  logger.debug({ reqId: meta.reqId }, 'platform db connection borrowed');
  try {
    return await fn(conn);
  } finally {
    await conn.close();
    logger.debug({ reqId: meta.reqId }, 'platform db connection released');
  }
}

export async function closePool() {
  await pool?.close(0);
  await platformPool?.close(0);
  pool = undefined;
  platformPool = undefined;
}
