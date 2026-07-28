import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { withPlatform } from '../../db/pool.js';
import { invalidate, invalidateHost } from '../../lib/cache.js';
import { generateTempPassword } from '../../lib/password.js';
import { signAccessToken } from '../../lib/jwt.js';
import { AppError } from '../../middleware/error.js';
import { insertLog, listLogs as listLogsRows } from '../logs/logs.repo.js';
import { readMetrics } from '../../middleware/metrics.js';
import { checkSsl } from '../../lib/ssl.js';
import { DEFAULT_HOME_SECTIONS, defaultSettings } from '@storeforge/shared';
import {
  insertCompany,
  insertDomain,
  insertAdmin,
  insertSetting,
  insertLang,
  insertOrderSeq,
  insertPage,
  insertSection,
  insertStarterCat,
  insertMenu,
  insertMenuItem,
  findCompanyById,
  findDomainByHost,
  findAdminByEmail,
  listCompanies as listCompaniesRows,
  updateCompany as updateCompanyRow,
  setCompanyStatus,
  findDomainById,
  deleteDomainById,
  listDomainsByCompany,
  listSettingsByCompany,
  countCompaniesByStatus,
  ordersPerCompany,
  storagePerCompany,
  companyHealth,
} from './platform.repo.js';

/** Step 6: every store starts with these four pages. */
const DEFAULT_PAGES = [
  { title: 'Home', slug: 'home', type: 'home' },
  { title: 'About', slug: 'about', type: 'page' },
  { title: 'Contact', slug: 'contact', type: 'page' },
  { title: 'Privacy', slug: 'privacy', type: 'page' },
];

/** Step 8: placeholders, so the catalog screens are never an empty void. */
const STARTER_CATS = [
  { name: 'Featured', slug: 'featured' },
  { name: 'New arrivals', slug: 'new-arrivals' },
  { name: 'Offers', slug: 'offers' },
];

/**
 * Step 9. Header links to the starter categories; footer to the content pages.
 * Nothing here names a client — the labels come from the defaults above, which
 * the owner renames from the admin on day one.
 */
const FOOTER_LINKS = ['about', 'contact', 'privacy'];

/**
 * All ten steps of 00-SYSTEM-DESIGN.md §6, in one transaction.
 *
 * Phase 0 could only do 1-5 and 10; steps 6-9 write to pages, sections, cats,
 * menus and menu_items, which did not exist until Phase 1's migrations. This is
 * the carry-over the Phase 0 report called its top item: from here, a company
 * created through this endpoint has a renderable home page, a navigable header
 * and footer, and starter categories, with no manual follow-up.
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
      await insertOrderSeq(conn, { companyId });

      // Step 6 — default pages.
      const pageIds = {};
      for (const page of DEFAULT_PAGES) {
        pageIds[page.slug] = await insertPage(conn, { companyId, ...page });
      }

      // Step 7 — the home page's starting sections, from the shared registry so
      // a new store's home page matches what the section arranger can edit.
      for (const [position, type] of DEFAULT_HOME_SECTIONS.entries()) {
        await insertSection(conn, {
          companyId,
          pageId: pageIds.home,
          type,
          position,
          settings: JSON.stringify(defaultSettings(type)),
        });
      }

      // Step 8 — starter categories.
      const catIds = [];
      for (const [position, cat] of STARTER_CATS.entries()) {
        catIds.push({ id: await insertStarterCat(conn, { companyId, ...cat, position }), ...cat });
      }

      // Step 9 — header and footer menus.
      const headerMenuId = await insertMenu(conn, { companyId, code: 'header', name: 'Header' });
      const footerMenuId = await insertMenu(conn, { companyId, code: 'footer', name: 'Footer' });

      for (const [position, cat] of catIds.entries()) {
        await insertMenuItem(conn, {
          companyId,
          menuId: headerMenuId,
          label: cat.name,
          linkType: 'cat',
          linkId: cat.id,
          position,
        });
      }
      for (const [position, slug] of FOOTER_LINKS.entries()) {
        const page = DEFAULT_PAGES.find((candidate) => candidate.slug === slug);
        await insertMenuItem(conn, {
          companyId,
          menuId: footerMenuId,
          label: page.title,
          linkType: 'page',
          linkId: pageIds[slug],
          position,
        });
      }

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

  const row = await withPlatform(async (conn) => {
    const updated = await updateCompanyRow(conn, merged);
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
    return updated;
  });

  // The tenant resolver serves this row from Redis on every storefront
  // request; a rename or a theme change has to be visible immediately, not in
  // five minutes.
  await invalidate(id, 'company');
  return row;
}

export async function listCompanyDomains({ companyId }) {
  await getCompany({ id: companyId });
  return withPlatform((conn) => listDomainsByCompany(conn, companyId));
}

export async function listCompanySettings({ companyId }) {
  await getCompany({ id: companyId });
  return withPlatform((conn) => listSettingsByCompany(conn, companyId));
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

  // Suspension is the one cache entry that must never be stale: a suspended
  // store still serving from cache is a store we have been asked to take down
  // and did not.
  await invalidate(id, 'company');
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

  await invalidateHost(domain.HOST);
}

export async function listLogs(query) {
  const { rows, total } = await withPlatform((conn) => listLogsRows(conn, query));
  return { rows, total, page: query.page, pageSize: query.pageSize };
}

export async function impersonate({ companyId, actorAdminId, ip }) {
  const company = await getCompany({ id: companyId });

  const jti = randomUUID();
  /*
   * `imp` is what makes the admin panel's banner possible.
   *
   * Without it the token is indistinguishable from a real owner login — the
   * panel would show the store exactly as its owner sees it, and whoever is
   * driving would have nothing reminding them that every action they take is
   * being taken against a client's live data under a platform account. The
   * company name rides along so the banner can name the store without a
   * second request.
   */
  const accessToken = signAccessToken(
    {
      sub: actorAdminId,
      company_id: companyId,
      role: 'owner',
      jti,
      imp: true,
      imp_company: company.NAME,
    },
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

  return { accessToken, company: { id: company.ID, name: company.NAME } };
}

/* ------------------------------------------------- monitoring (Phase 3, Task 4) */

/**
 * The Super Admin dashboard, in one call.
 *
 * Every number here crosses company boundaries by design, which is exactly
 * what `withPlatform` exists for — and why this router is `requireRole('platform')`.
 */
export async function platformOverview({ limit = 10 } = {}) {
  const [statusRows, orderRows, storageRows, requestMetrics] = await Promise.all([
    withPlatform((conn) => countCompaniesByStatus(conn)),
    withPlatform((conn) => ordersPerCompany(conn, { limit })),
    withPlatform((conn) => storagePerCompany(conn, { limit })),
    readMetrics({ slowestLimit: 8 }),
  ]);

  const byStatus = Object.fromEntries(statusRows.map((row) => [row.STATUS, row.CNT]));

  return {
    companies: {
      total: statusRows.reduce((sum, row) => sum + row.CNT, 0),
      active: byStatus.active ?? 0,
      suspended: byStatus.suspended ?? 0,
    },
    orders: orderRows.map((row) => ({
      companyId: row.ID,
      name: row.NAME,
      status: row.STATUS,
      orders24h: row.ORDERS_24H,
      orders7d: row.ORDERS_7D,
      revenue7d: row.REVENUE_7D,
      lastOrderAt: row.LAST_ORDER_AT,
    })),
    storage: storageRows.map((row) => ({
      companyId: row.ID,
      name: row.NAME,
      bytes: row.BYTES,
      files: row.FILES,
    })),
    requests: requestMetrics,
  };
}

/**
 * The per-company health card. `checkSsl` opens a real TLS connection per
 * domain, so it is opt-in (`?ssl=1`) rather than paid for on every load.
 */
export async function companyHealthCard({ companyId, includeSsl = false }) {
  const company = await getCompany({ id: companyId });
  const [health, domains] = await Promise.all([
    withPlatform((conn) => companyHealth(conn, companyId)),
    withPlatform((conn) => listDomainsByCompany(conn, companyId)),
  ]);

  const domainRows = domains.map((row) => ({
    id: row.ID,
    host: row.HOST,
    isPrimary: row.IS_PRIMARY === 1,
    createdAt: row.CREATED_AT,
  }));

  const ssl = includeSsl
    ? await Promise.all(domainRows.map((domain) => checkSsl(domain.host)))
    : null;

  return {
    company: {
      id: company.ID,
      name: company.NAME,
      status: company.STATUS,
      createdAt: company.CREATED_AT,
    },
    health: {
      lastOrderAt: health?.LAST_ORDER_AT ?? null,
      orderCount: health?.ORDER_COUNT ?? 0,
      ordersAwaiting: health?.ORDERS_AWAITING ?? 0,
      productCount: health?.PRODUCT_COUNT ?? 0,
      activeProductCount: health?.ACTIVE_PRODUCT_COUNT ?? 0,
      customerCount: health?.CUSTOMER_COUNT ?? 0,
      storageBytes: health?.STORAGE_BYTES ?? 0,
      adminLastLoginAt: health?.ADMIN_LAST_LOGIN_AT ?? null,
      activeAdminCount: health?.ACTIVE_ADMIN_COUNT ?? 0,
      lastActivityAt: health?.LAST_ACTIVITY_AT ?? null,
    },
    domains: domainRows,
    ssl,
  };
}
