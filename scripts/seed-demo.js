import oracledb from 'oracledb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const { initPool, closePool, withPlatform } = await import('../api/src/db/pool.js');
const { provisionCompany } = await import('../api/src/modules/platform/platform.service.js');
const { closeRedis } = await import('../api/src/lib/redis.js');

/**
 * The two themes Phase 1 ships, to prove the theming system works.
 *
 * They differ only in these token objects — no component, no template, no
 * conditional anywhere in the storefront knows which store it is rendering.
 * That includes the fonts and the header/footer arrangement, which are token
 * values rather than code branches.
 *
 * Neither is an AI-design default: no cream-and-terracotta serif, no
 * black-with-acid-green. "Cleaver" is a butcher's palette — deep forest, warm
 * ochre, bone; "Harbour" is cool, quiet retail — ink, stone, a single blue.
 */
const THEMES = [
  {
    code: 'cleaver',
    name: 'Cleaver (warm retail)',
    tokens: {
      color: {
        bg: '#fbfaf7',
        surface: '#f1ede4',
        text: '#1d2419',
        muted: '#5f6b58',
        border: '#ddd8ca',
        primary: '#24401f',
        primaryText: '#f7f5ef',
        // 5.8:1 on this theme's off-white background. The lighter ochre it
        // replaced measured 4.47:1 — just under AA for normal text, which
        // Lighthouse caught on the language switcher.
        accent: '#8f5316',
        sale: '#a3301f',
      },
      font: { display: 'bricolage', body: 'publicsans' },
      radius: { sm: '4px', md: '8px', lg: '14px', pill: '999px' },
      layout: { header: 'classic', footer: 'columns' },
    },
  },
  {
    code: 'harbour',
    name: 'Harbour (clean modern)',
    tokens: {
      color: {
        bg: '#ffffff',
        surface: '#f4f6f8',
        text: '#101418',
        muted: '#66707c',
        border: '#e2e6ea',
        primary: '#101418',
        primaryText: '#ffffff',
        accent: '#1f6feb',
        sale: '#c2410c',
      },
      font: { display: 'manrope', body: 'manrope' },
      radius: { sm: '8px', md: '14px', lg: '24px', pill: '999px' },
      layout: { header: 'centered', footer: 'compact' },
    },
  },
  {
    /**
     * A butcher/grocer retail look — the reference quality bar CLAUDE.md names.
     *
     * The palette is original: warm off-white paper, near-black charcoal for
     * the header and buttons, and a deep butcher red as the accent. Contrast
     * was chosen to pass, not to look approximately right — the accent
     * measures ~7:1 on the background and the muted text ~5:1, because Phase 1
     * lost an afternoon to an ochre that sat at 4.47:1 and failed AA by a
     * hair.
     *
     * Nothing here is copied from any particular shop's branding. A client
     * with their own photography and logo drops them in and the theme carries
     * them; that is the whole point of tokens being data.
     */
    code: 'butcher',
    name: 'Butcher Block (bold retail)',
    tokens: {
      color: {
        bg: '#fdfbf7',
        surface: '#f4efe6',
        text: '#17140f',
        muted: '#665c4e',
        border: '#e4dccd',
        primary: '#1a1614',
        primaryText: '#fbf7f0',
        accent: '#9c1c1c',
        sale: '#b3261e',
      },
      font: { display: 'bricolage', body: 'publicsans' },
      // Squarer than Harbour: a butcher's shop is not a fintech.
      radius: { sm: '3px', md: '6px', lg: '10px', pill: '999px' },
      layout: { header: 'classic', footer: 'columns' },
    },
  },
];

const DEMOS = [
  {
    name: 'Demo Store A',
    domainHost: 'demo-a.localhost',
    themeCode: 'cleaver',
    adminEmail: 'admin@demo-a.localhost',
    currency: 'BDT',
  },
  {
    name: 'Demo Store B',
    domainHost: 'demo-b.localhost',
    themeCode: 'harbour',
    adminEmail: 'admin@demo-b.localhost',
    currency: 'AED',
  },
  {
    name: 'Demo Store C',
    domainHost: 'demo-c.localhost',
    themeCode: 'butcher',
    adminEmail: 'admin@demo-c.localhost',
    currency: 'BDT',
  },
];

async function ensureTheme(conn, theme) {
  const existing = await conn.execute('SELECT id FROM themes WHERE code = :code', { code: theme.code });
  if (existing.rows.length > 0) {
    // Keep the tokens current: re-running the seed after a theme edit should
    // update the row, not silently leave the old palette in place.
    await conn.execute('UPDATE themes SET name = :name, tokens = :tokens WHERE code = :code', {
      code: theme.code,
      name: theme.name,
      tokens: JSON.stringify(theme.tokens),
    });
    await conn.commit();
    return existing.rows[0].ID;
  }

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
      const r = await conn.execute('SELECT company_id FROM domains WHERE host = :host', {
        host: demo.domainHost,
      });
      return r.rows[0] ?? null;
    });

    if (existing) {
      // Still idempotently repair the currency: stores provisioned before
      // Phase 3 have none, and a product page with a price but no currency
      // emits no `offers` at all in its structured data (lib/seo.js explains
      // why guessing one would be worse).
      await withPlatform(async (conn) => {
        await conn.execute(
          `UPDATE companies SET currency = :currency, updated_at = SYSTIMESTAMP
            WHERE id = :companyId AND currency IS NULL`,
          { currency: demo.currency, companyId: existing.COMPANY_ID },
        );
        await conn.commit();
      });
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
        currency: demo.currency,
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
