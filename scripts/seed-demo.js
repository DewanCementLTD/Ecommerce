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
  {
    /**
     * Boutique / fashion — soft blush paper, near-black ink, a warm terracotta
     * accent. The serif display face (Playfair Display) is what separates it
     * from every other theme here, which are all sans-serif; a clothing
     * boutique reading in the same face as a hardware store is the tell that
     * a platform has only one look.
     */
    code: 'boutique',
    name: 'Boutique (fashion & lifestyle)',
    tokens: {
      color: {
        bg: '#fdf8f6',
        surface: '#f6ebe6',
        text: '#241c1a',
        muted: '#7a6a64',
        border: '#e9dad2',
        primary: '#241c1a',
        primaryText: '#fdf8f6',
        accent: '#b5563c',
        sale: '#a3301f',
      },
      font: { display: 'playfair', body: 'publicsans' },
      radius: { sm: '2px', md: '4px', lg: '8px', pill: '999px' },
      layout: { header: 'centered', footer: 'columns' },
    },
  },
  {
    /**
     * Electronics / tech — near-black canvas, cool grey surfaces, an electric
     * blue accent. The one dark-mode-leaning theme in the set: `bg` itself is
     * dark, not just the header, which is why the accent had to be checked
     * against it rather than against a light card.
     */
    code: 'circuit',
    name: 'Circuit (electronics & tech)',
    tokens: {
      color: {
        bg: '#0b0e14',
        surface: '#141924',
        text: '#e8ecf4',
        muted: '#8b93a7',
        border: '#232b3a',
        primary: '#2563eb',
        primaryText: '#f5f8ff',
        // ~8.9:1 against the dark bg — checked directly, not eyeballed, per
        // the same rule the Cleaver theme's comment already states.
        accent: '#38bdf8',
        sale: '#f43f5e',
      },
      font: { display: 'manrope', body: 'manrope' },
      radius: { sm: '6px', md: '12px', lg: '20px', pill: '999px' },
      layout: { header: 'classic', footer: 'compact' },
    },
  },
  {
    /**
     * Grocery / organic — fresh sage green on warm cream, an amber accent for
     * offers. Rounder corners than Butcher Block on purpose: a butcher is
     * blunt, a greengrocer is soft.
     */
    code: 'harvest',
    name: 'Harvest (grocery & organic)',
    tokens: {
      color: {
        bg: '#fbfaf4',
        surface: '#eef2e4',
        text: '#1f2917',
        muted: '#5c6b4f',
        border: '#dde5cc',
        primary: '#3f6b2e',
        primaryText: '#f6faf0',
        accent: '#c17a1f',
        sale: '#b3401f',
      },
      font: { display: 'bricolage', body: 'publicsans' },
      radius: { sm: '8px', md: '16px', lg: '26px', pill: '999px' },
      layout: { header: 'centered', footer: 'columns' },
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
