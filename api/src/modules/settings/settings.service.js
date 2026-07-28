import { withCompany } from '../../db/pool.js';
import * as repo from './settings.repo.js';

function toMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.KEY, row.VALUE]));
}

export async function getSettings({ companyId }) {
  const rows = await withCompany(companyId, (conn) => repo.listSettings(conn, { companyId }));
  return { settings: toMap(rows) };
}

export async function putSettings({ companyId, values }) {
  await withCompany(companyId, async (conn) => {
    for (const [key, value] of Object.entries(values)) {
      await repo.upsertSetting(conn, { companyId, key, value: value ?? '' });
    }
    await conn.commit();
  });
  return getSettings({ companyId });
}
