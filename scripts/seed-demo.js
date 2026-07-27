import oracledb from 'oracledb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const { initPool, closePool, withPlatform } = await import('../api/src/db/pool.js');
const { provisionCompany } = await import('../api/src/modules/platform/platform.service.js');
const { closeRedis } = await import('../api/src/lib/redis.js');

const THEMES = [
  {
    code: 'ocean',
    name: 'Ocean Blue',
    tokens: { primaryColor: '#1d4ed8', secondaryColor: '#0ea5e9', backgroundColor: '#ffffff', textColor: '#0f172a' },
  },
  {
    code: 'sunset',
    name: 'Sunset Orange',
    tokens: { primaryColor: '#ea580c', secondaryColor: '#facc15', backgroundColor: '#fffbeb', textColor: '#431407' },
  },
];

const DEMOS = [
  { name: 'Demo Store A', domainHost: 'demo-a.localhost', themeCode: 'ocean', adminEmail: 'admin@demo-a.localhost' },
  { name: 'Demo Store B', domainHost: 'demo-b.localhost', themeCode: 'sunset', adminEmail: 'admin@demo-b.localhost' },
];

async function ensureTheme(conn, theme) {
  const existing = await conn.execute('SELECT id FROM themes WHERE code = :code', { code: theme.code });
  if (existing.rows.length > 0) return existing.rows[0].ID;

  const result = await conn.execute(
    `INSERT INTO themes (code, name, tokens, is_active) VALUES (:code, :name, :tokens, 1)
     RETURNING id INTO :id`,
    {
      code: theme.code,
      name: theme.name,
      tokens: JSON.stringify(theme.tokens),
      id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
    },
  );
  await conn.commit();
  return result.outBinds.id[0];
}

async function run() {
  await initPool();

  const themeIds = await withPlatform(async (conn) => {
    const ids = {};
    for (const theme of THEMES) {
      ids[theme.code] = await ensureTheme(conn, theme);
    }
    return ids;
  });

  for (const demo of DEMOS) {
    const existing = await withPlatform(async (conn) => {
      const r = await conn.execute('SELECT id FROM domains WHERE host = :host', { host: demo.domainHost });
      return r.rows[0] ?? null;
    });

    if (existing) {
      console.log(`${demo.domainHost} already provisioned (company ${existing.COMPANY_ID}), skipping.`);
      continue;
    }

    const result = await provisionCompany(
      {
        name: demo.name,
        domainHost: demo.domainHost,
        adminEmail: demo.adminEmail,
        adminName: 'Demo Admin',
        themeId: themeIds[demo.themeCode],
        defaultLangCode: 'en',
        defaultLangName: 'English',
      },
      { actorAdminId: null, ip: '127.0.0.1' },
    );

    console.log(
      `Provisioned ${demo.name} at ${demo.domainHost} (company ${result.company.ID}), admin ${demo.adminEmail} / ${result.admin.tempPassword}`,
    );
  }
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeRedis();
  });
