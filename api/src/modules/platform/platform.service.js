import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { withPlatform } from '../../db/pool.js';
import { getRedis } from '../../lib/redis.js';
import { generateTempPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { AppError } from '../../middleware/error.js';
import { insertLog } from '../logs/logs.repo.js';
import {
  insertCompany,
  insertDomain,
  insertAdmin,
  insertSetting,
  insertLang,
  findCompanyById,
  findDomainByHost,
  findAdminByEmail,
  listCompanies as listCompaniesRows,
  updateCompany as updateCompanyRow,
  setCompanyStatus,
  findDomainById,
  deleteDomainById,
} from './platform.repo.js';

/**
 * Phase 0 provisioning covers steps 1-5 and 10 of 00-SYSTEM-DESIGN.md §6
 * (company, domain, first admin, default settings, default language, audit
 * log). Steps 6-9 (pages/sections/cats/menus) move to Phase 1 once those
 * tables exist — see docs/DECISIONS.md.
 */
export async function provisionCompany(input, { actorAdminId, ip }) {
  const tempPassword = generateTempPassword();
  const passHash = await argon2.hash(tempPassword);

  const ids = await withPlatform(async (conn) => {
    try {
      const existingDomain = await findDomainByHost(conn, input.domainHost);
      if (existingDomain) {
        throw new AppError(409, 'DOMAIN_TAKEN', 'That domain is already connected to a store.');
      }
      const existingAdmin = await findAdminByEmail(conn, input.adminEmail);
      if (existingAdmin) {
        throw new AppError(409, 'EMAIL_TAKEN', 'That email is already in use.');
      }

      const companyId = await insertCompany(conn, input);
      const domainId = await insertDomain(conn, { companyId, host: input.domainHost, isPrimary: true });
      const adminId = await insertAdmin(conn, {
        companyId,
        email: input.adminEmail,
        passHash,
        name: input.adminName,
        role: 'owner',
      });
      await insertSetting(conn, { companyId, key: 'seo_title', value: input.name });
      await insertSetting(conn, { companyId, key: 'seo_description', value: '' });
      await insertLang(conn, {
        companyId,
        code: input.defaultLangCode,
        name: input.defaultLangName,
        isDefault: true,
      });
      await insertLog(conn, {
        companyId,
        adminId: actorAdminId,
        action: 'company_created',
        entity: 'company',
        entityId: companyId,
        meta: { domainHost: input.domainHost },
        ip,
      });

      await conn.commit();
      return { companyId, domainId, adminId };
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });

  const company = await withPlatform((conn) => findCompanyById(conn, ids.companyId));

  return {
    company,
    domain: { id: ids.domainId, host: input.domainHost },
    admin: { id: ids.adminId, email: input.adminEmail, tempPassword },
  };
}

export async function listCompanies({ page, pageSize, search, status }) {
  const { rows, total } = await withPlatform((conn) =>
    listCompaniesRows(conn, { page, pageSize, search, status }),
  );
  return { rows, total, page, pageSize };
}

export async function getCompany({ id }) {
  const company = await withPlatform((conn) => findCompanyById(conn, id));
  if (!company) {
    throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  }
  return company;
}

export async function updateCompany({ id, actorAdminId, ip, ...fields }) {
  const existing = await getCompany({ id });
  const merged = {
    id,
    name: fields.name ?? existing.NAME,
    bizName: fields.bizName ?? existing.BIZ_NAME,
    email: fields.email ?? existing.EMAIL,
    phone: fields.phone ?? existing.PHONE,
    currency: fields.currency ?? existing.CURRENCY,
    timezone: fields.timezone ?? existing.TIMEZONE,
    themeId: fields.themeId ?? existing.THEME_ID,
  };

  return withPlatform(async (conn) => {
    const row = await updateCompanyRow(conn, merged);
    await insertLog(conn, {
      companyId: id,
      adminId: actorAdminId,
      action: 'company_updated',
      entity: 'company',
      entityId: id,
      meta: fields,
      ip,
    });
    await conn.commit();
    return row;
  });
}

async function changeCompanyStatus({ id, status, actorAdminId, ip }) {
  const ok = await withPlatform(async (conn) => {
    const changed = await setCompanyStatus(conn, { id, status });
    if (changed) {
      await insertLog(conn, {
        companyId: id,
        adminId: actorAdminId,
        action: status === 'suspended' ? 'company_suspended' : 'company_activated',
        entity: 'company',
        entityId: id,
        meta: {},
        ip,
      });
      await conn.commit();
    }
    return changed;
  });
  if (!ok) {
    throw new AppError(404, 'COMPANY_NOT_FOUND', 'Company not found.');
  }
}

export const suspendCompany = (args) => changeCompanyStatus({ ...args, status: 'suspended' });
export const activateCompany = (args) => changeCompanyStatus({ ...args, status: 'active' });

export async function addDomain({ companyId, host, actorAdminId, ip }) {
  await getCompany({ id: companyId });

  const domainId = await withPlatform(async (conn) => {
    const existing = await findDomainByHost(conn, host);
    if (existing) {
      throw new AppError(409, 'DOMAIN_TAKEN', 'That domain is already connected to a store.');
    }
    const id = await insertDomain(conn, { companyId, host, isPrimary: false });
    await insertLog(conn, {
      companyId,
      adminId: actorAdminId,
      action: 'domain_added',
      entity: 'domain',
      entityId: id,
      meta: { host },
      ip,
    });
    await conn.commit();
    return id;
  });

  return { id: domainId, companyId, host };
}

export async function removeDomain({ domainId, actorAdminId, ip }) {
  const domain = await withPlatform((conn) => findDomainById(conn, domainId));
  if (!domain) {
    throw new AppError(404, 'DOMAIN_NOT_FOUND', 'Domain not found.');
  }

  await withPlatform(async (conn) => {
    await deleteDomainById(conn, domainId);
    await insertLog(conn, {
      companyId: domain.COMPANY_ID,
      adminId: actorAdminId,
      action: 'domain_removed',
      entity: 'domain',
      entityId: domainId,
      meta: { host: domain.HOST },
      ip,
    });
    await conn.commit();
  });

  await getRedis().del(`host:${domain.HOST}`);
}

export async function impersonate({ companyId, actorAdminId, ip }) {
  await getCompany({ id: companyId });

  const jti = randomUUID();
  const accessToken = signAccessToken(
    { sub: actorAdminId, company_id: companyId, role: 'owner', jti },
    { expiresIn: '10m' },
  );

  await withPlatform(async (conn) => {
    await insertLog(conn, {
      companyId,
      adminId: actorAdminId,
      action: 'impersonate',
      entity: 'company',
      entityId: companyId,
      meta: {},
      ip,
    });
    await conn.commit();
  });

  return { accessToken };
}
