import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { withPlatform } from '../../db/pool.js';
import { getRedis } from '../../lib/redis.js';
import { platformKey } from '../../lib/cache.js';
import { env } from '../../config/env.js';
import { parseDurationToSeconds } from '../../lib/duration.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { AppError } from '../../middleware/error.js';
import { findAdminByEmail, findAdminById, touchLastLogin } from './auth.repo.js';
import { findCompanyIdByHost } from '../tenants/tenants.repo.js';
import { insertLog } from '../logs/logs.repo.js';

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = parseDurationToSeconds(env.jwt.refreshTtl);

function failKey(email) {
  return platformKey('auth', 'fail', email.toLowerCase());
}

async function isLockedOut(redis, email) {
  const count = Number((await redis.get(failKey(email))) ?? 0);
  return count >= FAILED_LOGIN_LIMIT;
}

async function recordFailedLogin(redis, email) {
  const key = failKey(email);
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, FAILED_LOGIN_WINDOW_SECONDS);
  }
}

async function clearFailedLogins(redis, email) {
  await redis.del(failKey(email));
}

function buildTokens(admin) {
  const claims = { sub: admin.ID, company_id: admin.COMPANY_ID, role: admin.ROLE };
  const jti = randomUUID();
  const refreshJti = randomUUID();
  return {
    accessToken: signAccessToken({ ...claims, jti }),
    refreshToken: signRefreshToken({ ...claims, jti: refreshJti }),
    refreshJti,
  };
}

/**
 * Refuses a login on a store the account does not belong to.
 *
 * Now that the client admin is served at `{store-domain}/admin`, the URL
 * carries a claim about which store you are managing — and without this check
 * that claim is decorative. A owner of store A could log in at store B's
 * `/admin` and get their *own* store's data, because the company comes from
 * the JWT rather than the URL. Not a data leak, but a genuinely confusing one:
 * the address bar says one shop and the screen shows another.
 *
 * Platform admins are exempt. They have no `company_id` and legitimately log
 * in from the platform's own domain to reach every store.
 *
 * A host that belongs to no store is not an error here — the Super Admin panel
 * and local development both log in on hosts that are not client domains.
 */
async function assertAdminBelongsToHost({ admin, host }) {
  if (!host || admin.ROLE === 'platform') return;

  const companyId = await withPlatform((conn) => findCompanyIdByHost(conn, host));
  if (!companyId) return;

  if (Number(admin.COMPANY_ID) !== Number(companyId)) {
    throw new AppError(
      403,
      'WRONG_STORE',
      'That account does not belong to this store. Check the address you are signing in on.',
    );
  }
}

export async function login({ email, password, host, ip }) {
  const redis = getRedis();

  if (await isLockedOut(redis, email)) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed logins. Try again in 15 minutes.');
  }

  const admin = await withPlatform((conn) => findAdminByEmail(conn, email));
  const passwordOk = admin ? await argon2.verify(admin.PASS_HASH, password).catch(() => false) : false;

  if (!admin || admin.IS_ACTIVE !== 1 || !passwordOk) {
    await recordFailedLogin(redis, email);
    await withPlatform(async (conn) => {
      await insertLog(conn, {
        companyId: admin?.COMPANY_ID ?? null,
        adminId: admin?.ID ?? null,
        action: 'login_failed',
        entity: 'admin',
        entityId: admin?.ID ?? null,
        meta: { email },
        ip,
      });
      await conn.commit();
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  await assertAdminBelongsToHost({ admin, host });

  await clearFailedLogins(redis, email);

  const { accessToken, refreshToken, refreshJti } = buildTokens(admin);
  await redis.set(platformKey('auth', 'refresh', refreshJti), String(admin.ID), 'EX', REFRESH_TTL_SECONDS);

  await withPlatform(async (conn) => {
    await touchLastLogin(conn, admin.ID);
    await insertLog(conn, {
      companyId: admin.COMPANY_ID,
      adminId: admin.ID,
      action: 'login',
      entity: 'admin',
      entityId: admin.ID,
      meta: {},
      ip,
    });
    await conn.commit();
  });

  return {
    accessToken,
    refreshToken,
    admin: {
      id: admin.ID,
      companyId: admin.COMPANY_ID,
      role: admin.ROLE,
      name: admin.NAME,
      email: admin.EMAIL,
    },
  };
}

export async function refresh({ refreshToken }) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token.');
  }

  const redis = getRedis();
  const key = platformKey('auth', 'refresh', decoded.jti);
  const stillValid = await redis.get(key);
  if (!stillValid) {
    throw new AppError(401, 'INVALID_TOKEN', 'Refresh token has already been used or revoked.');
  }
  await redis.del(key);

  const admin = await withPlatform((conn) => findAdminById(conn, decoded.sub));
  if (!admin || admin.IS_ACTIVE !== 1) {
    throw new AppError(401, 'INVALID_TOKEN', 'Account is no longer active.');
  }

  const { accessToken, refreshToken: newRefreshToken, refreshJti } = buildTokens(admin);
  await redis.set(platformKey('auth', 'refresh', refreshJti), String(admin.ID), 'EX', REFRESH_TTL_SECONDS);

  return { accessToken, refreshToken: newRefreshToken };
}

/** @param {{ admin: { id: number, companyId: number|null, jti: string, exp: number }, ip?: string }} args */
export async function logout({ admin, ip }) {
  const redis = getRedis();
  const ttl = Math.max(admin.exp - Math.floor(Date.now() / 1000), 1);
  await redis.set(platformKey('auth', 'blacklist', admin.jti), '1', 'EX', ttl);

  await withPlatform(async (conn) => {
    await insertLog(conn, {
      companyId: admin.companyId,
      adminId: admin.id,
      action: 'logout',
      entity: 'admin',
      entityId: admin.id,
      meta: {},
      ip,
    });
    await conn.commit();
  });
}
