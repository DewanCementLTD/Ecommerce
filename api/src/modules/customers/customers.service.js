import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { withCompany } from '../../db/pool.js';
import { getRedis } from '../../lib/redis.js';
import { env } from '../../config/env.js';
import { parseDurationToSeconds } from '../../lib/duration.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../lib/jwt.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import { AppError } from '../../middleware/error.js';
import { isUniqueViolation } from '../../lib/dbErrors.js';
import * as repo from './customers.repo.js';

const FAILED_LOGIN_LIMIT = 5;
const FAILED_LOGIN_WINDOW_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = parseDurationToSeconds(env.jwt.refreshTtl);

function failKey(companyId, email) {
  return `custauth:fail:${companyId}:${email.toLowerCase()}`;
}

function toCustomerDto(row) {
  const customer = camelRow(row);
  if (!customer) return null;
  delete customer.passHash;
  return customer;
}

function buildTokens({ companyId, customerId }) {
  const claims = { sub: customerId, company_id: companyId, role: 'customer' };
  const jti = randomUUID();
  const refreshJti = randomUUID();
  return {
    accessToken: signAccessToken({ ...claims, jti }),
    refreshToken: signRefreshToken({ ...claims, jti: refreshJti }),
    refreshJti,
  };
}

/* --------------------------------------------------------------------- auth */

export async function register({ companyId, email, password, name, phone }) {
  const passHash = await argon2.hash(password);

  const customerId = await withCompany(companyId, async (conn) => {
    const existing = await repo.findCustomerByEmail(conn, { companyId, email });
    if (existing) {
      if (existing.PASS_HASH) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists.');
      }
      // Upgrades a guest checkout's customer row into a real account instead
      // of failing on the email's unique index.
      await repo.updateCustomer(conn, { companyId, id: existing.ID, name, phone, passHash });
      await conn.commit();
      return existing.ID;
    }

    try {
      const id = await repo.insertCustomer(conn, { companyId, email, phone, name, passHash });
      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      if (isUniqueViolation(err, 'customers_company_email_uq')) {
        throw new AppError(409, 'EMAIL_TAKEN', 'An account with that email already exists.');
      }
      throw err;
    }
  });

  const { accessToken, refreshToken, refreshJti } = buildTokens({ companyId, customerId });
  await getRedis().set(`custauth:refresh:${refreshJti}`, String(customerId), 'EX', REFRESH_TTL_SECONDS);

  const row = await withCompany(companyId, (conn) => repo.findCustomerById(conn, { companyId, id: customerId }));
  return { accessToken, refreshToken, customer: toCustomerDto(row) };
}

export async function login({ companyId, email, password }) {
  const redis = getRedis();
  const key = failKey(companyId, email);

  if (Number((await redis.get(key)) ?? 0) >= FAILED_LOGIN_LIMIT) {
    throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed logins. Try again in 15 minutes.');
  }

  const row = await withCompany(companyId, (conn) => repo.findCustomerByEmail(conn, { companyId, email }));
  const passwordOk = row?.PASS_HASH ? await argon2.verify(row.PASS_HASH, password).catch(() => false) : false;

  if (!row || row.IS_ACTIVE !== 1 || !passwordOk) {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, FAILED_LOGIN_WINDOW_SECONDS);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  await redis.del(key);

  const { accessToken, refreshToken, refreshJti } = buildTokens({ companyId, customerId: row.ID });
  await redis.set(`custauth:refresh:${refreshJti}`, String(row.ID), 'EX', REFRESH_TTL_SECONDS);

  return { accessToken, refreshToken, customer: toCustomerDto(row) };
}

export async function refresh({ refreshToken }) {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token.');
  }
  if (decoded.role !== 'customer') {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid or expired refresh token.');
  }

  const redis = getRedis();
  const key = `custauth:refresh:${decoded.jti}`;
  if (!(await redis.get(key))) {
    throw new AppError(401, 'INVALID_TOKEN', 'Refresh token has already been used or revoked.');
  }
  await redis.del(key);

  const row = await withCompany(decoded.company_id, (conn) =>
    repo.findCustomerById(conn, { companyId: decoded.company_id, id: decoded.sub }),
  );
  if (!row || row.IS_ACTIVE !== 1) {
    throw new AppError(401, 'INVALID_TOKEN', 'Account is no longer active.');
  }

  const tokens = buildTokens({ companyId: decoded.company_id, customerId: row.ID });
  await redis.set(`custauth:refresh:${tokens.refreshJti}`, String(row.ID), 'EX', REFRESH_TTL_SECONDS);
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export async function logout({ customer }) {
  const redis = getRedis();
  const ttl = Math.max(customer.exp - Math.floor(Date.now() / 1000), 1);
  await redis.set(`custauth:blacklist:${customer.jti}`, '1', 'EX', ttl);
}

export async function getMe({ companyId, id }) {
  const row = await withCompany(companyId, (conn) => repo.findCustomerById(conn, { companyId, id }));
  if (!row) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
  return toCustomerDto(row);
}

export async function patchMe({ companyId, id, name, phone, acceptsMarketing }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findCustomerById(conn, { companyId, id });
    if (!existing) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
    await repo.updateCustomer(conn, { companyId, id, name, phone, acceptsMarketing });
    await conn.commit();
  });
  return getMe({ companyId, id });
}

/**
 * Used by checkout (Task 4), never exposed as its own endpoint. Matches by
 * email when one is given (so a returning guest's second order lands on the
 * same customer row); a phone-only guest always gets a fresh row rather than
 * a brittle phone-matching heuristic.
 */
export async function findOrCreateGuestCustomer(conn, { companyId, name, phone, email }) {
  if (email) {
    const existing = await repo.findCustomerByEmail(conn, { companyId, email });
    if (existing) return existing;
  }
  const id = await repo.insertCustomer(conn, { companyId, email: email ?? null, phone, name });
  return repo.findCustomerById(conn, { companyId, id });
}

/* -------------------------------------------------------------------- admin */

export async function listCustomers({ companyId, page, pageSize, search }) {
  const { rows, total } = await withCompany(companyId, (conn) =>
    repo.listCustomers(conn, { companyId, page, pageSize, search }),
  );
  return { rows: camelRows(rows), total, page, pageSize };
}

export async function adminPatchCustomer({ companyId, id, isActive }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findCustomerById(conn, { companyId, id });
    if (!existing) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
    await repo.updateCustomer(conn, { companyId, id, isActive });
    await conn.commit();
  });
  const row = await withCompany(companyId, (conn) => repo.findCustomerById(conn, { companyId, id }));
  return toCustomerDto(row);
}

/* ------------------------------------------------------------------- addrs */

export async function listAddrs({ companyId, customerId }) {
  const rows = await withCompany(companyId, (conn) => repo.listAddrs(conn, { companyId, customerId }));
  return { rows: camelRows(rows) };
}

export async function createAddr({ companyId, customerId, ...input }) {
  await withCompany(companyId, async (conn) => {
    if (input.isDefault) await repo.clearDefaultAddr(conn, { companyId, customerId });
    await repo.insertAddr(conn, { companyId, customerId, ...input });
    await conn.commit();
  });
  return listAddrs({ companyId, customerId });
}

export async function patchAddr({ companyId, customerId, id, ...input }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findAddrById(conn, { companyId, customerId, id });
    if (!existing) throw new AppError(404, 'ADDR_NOT_FOUND', 'Address not found.');
    if (input.isDefault) await repo.clearDefaultAddr(conn, { companyId, customerId });
    await repo.updateAddr(conn, { companyId, customerId, id, ...input });
    await conn.commit();
  });
  return listAddrs({ companyId, customerId });
}

export async function deleteAddr({ companyId, customerId, id }) {
  const deleted = await withCompany(companyId, async (conn) => {
    const result = await repo.deleteAddr(conn, { companyId, customerId, id });
    await conn.commit();
    return result;
  });
  if (!deleted) throw new AppError(404, 'ADDR_NOT_FOUND', 'Address not found.');
  return listAddrs({ companyId, customerId });
}
