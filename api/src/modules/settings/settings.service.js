import { withCompany } from '../../db/pool.js';
import { cached, invalidate, TTL } from '../../lib/cache.js';
import * as repo from './settings.repo.js';

function toMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.KEY, row.VALUE]));
}

/**
 * Cached for 5 minutes (`00-SYSTEM-DESIGN.md §7`). Every storefront page load
 * reads these — the SEO defaults, the social links — so this is a hot query
 * that changes a few times a year.
 *
 * The admin reads through the same cache rather than around it: `putSettings`
 * drops the entry in the same call that writes it, so an admin's own save is
 * never stale, and one code path is easier to trust than two.
 */
export async function getSettings({ companyId }) {
  return cached(companyId, 'settings', TTL.settings, async () => {
    const rows = await withCompany(companyId, (conn) => repo.listSettings(conn, { companyId }));
    return { settings: toMap(rows) };
  });
}

export async function putSettings({ companyId, values }) {
  await withCompany(companyId, async (conn) => {
    for (const [key, value] of Object.entries(values)) {
      await repo.upsertSetting(conn, { companyId, key, value: value ?? '' });
    }
    await conn.commit();
  });

  await invalidate(companyId, 'settings');
  return getSettings({ companyId });
}
