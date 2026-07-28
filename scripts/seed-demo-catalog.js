/**
 * Dev-only demo content: images, categories, products, banners, and the home
 * page sections wired to them, for the two demo stores.
 *
 * This is seed data, not application data — nothing here is referenced by
 * source. Images are generated locally with sharp rather than downloaded, so
 * the script works offline and ships no third-party assets.
 *
 * Idempotent: it skips a store that already has products.
 */
import oracledb from 'oracledb';
import path from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const { initPool, closePool, withPlatform, withCompany } = await import('../api/src/db/pool.js');
const { closeRedis } = await import('../api/src/lib/redis.js');
const { MEDIA_WIDTHS, writeVariant } = await import('../api/src/lib/mediaStorage.js');
const { randomUUID } = await import('node:crypto');

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

const CATS = [
  { name: 'Beef', slug: 'beef', tone: ['#5b2b2b', '#8c4a3d'] },
  { name: 'Lamb', slug: 'lamb', tone: ['#4a3b2a', '#7d6242'] },
  { name: 'Poultry', slug: 'poultry', tone: ['#6b5a2e', '#a08b4a'] },
  { name: 'Ready to cook', slug: 'ready-to-cook', tone: ['#2f4739', '#4e705a'] },
];

const PRODUCTS = [
  { name: 'Dry-aged ribeye', cat: 'beef', price: 42.0, sale: null, stock: 12, brand: 'Highland', tags: ['grill', 'premium'], featured: true, short: '28-day dry-aged, bone in.' },
  { name: 'Beef short ribs', cat: 'beef', price: 26.5, sale: 22.0, stock: 8, brand: 'Highland', tags: ['slow-cook'], featured: true, short: 'Cut thick for slow cooking.' },
  { name: 'Lamb shoulder', cat: 'lamb', price: 31.0, sale: null, stock: 5, brand: 'Fellside', tags: ['roast'], featured: false, short: 'Whole shoulder, bone in.' },
  { name: 'Lamb kofta', cat: 'lamb', price: 14.0, sale: null, stock: 20, brand: 'Fellside', tags: ['grill', 'quick'], featured: true, short: 'Hand-rolled with parsley and cumin.' },
  { name: 'Free-range chicken', cat: 'poultry', price: 12.5, sale: null, stock: 16, brand: 'Marsh Farm', tags: ['roast'], featured: false, short: 'Whole bird, about 1.6kg.' },
  { name: 'Chicken thighs', cat: 'poultry', price: 8.9, sale: 7.5, stock: 0, brand: 'Marsh Farm', tags: ['grill', 'quick'], featured: false, short: 'Boneless and skinless.' },
  { name: 'Marinated skewers', cat: 'ready-to-cook', price: 16.0, sale: null, stock: 9, brand: null, tags: ['grill', 'quick'], featured: true, short: 'Ready for the grill, six to a pack.' },
  { name: 'Butcher’s burgers', cat: 'ready-to-cook', price: 11.0, sale: null, stock: 24, brand: null, tags: ['grill'], featured: false, short: 'Four 170g patties, coarse ground.' },
];

/** A generated image: a soft two-tone gradient with a subtle grain. No text. */
async function makeImage({ width, height, tone }) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${tone[0]}"/>
        <stop offset="100%" stop-color="${tone[1]}"/>
      </linearGradient>
      <radialGradient id="v" cx="50%" cy="40%" r="75%">
        <stop offset="60%" stop-color="rgba(0,0,0,0)"/>
        <stop offset="100%" stop-color="rgba(0,0,0,0.35)"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <rect width="100%" height="100%" fill="url(#v)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}

async function insertMedia(conn, { companyId, filename, buffer }) {
  const metadata = await sharp(buffer).metadata();
  const storageKey = `${companyId}/${randomUUID()}`;

  for (const width of MEDIA_WIDTHS.filter((w) => w <= (metadata.width ?? w))) {
    const variant = await sharp(buffer).resize({ width, withoutEnlargement: true }).webp().toBuffer();
    await writeVariant(storageKey, width, variant);
  }

  const result = await conn.execute(
    `INSERT INTO media (company_id, filename, mime, size_bytes, width, height, storage_key)
     VALUES (:companyId, :filename, 'image/webp', :sizeBytes, :width, :height, :storageKey)
     RETURNING id INTO :id`,
    {
      companyId,
      filename,
      sizeBytes: buffer.length,
      width: metadata.width,
      height: metadata.height,
      storageKey,
      id: OUT_ID,
    },
  );
  return result.outBinds.id[0];
}

async function seedStore(companyId, storeName) {
  const already = await withCompany(companyId, async (conn) => {
    const result = await conn.execute('SELECT COUNT(*) AS cnt FROM products WHERE company_id = :companyId', {
      companyId,
    });
    return result.rows[0].CNT;
  });

  if (already > 0) {
    console.log(`  ${storeName}: already has ${already} products, skipping.`);
    return;
  }

  await withCompany(companyId, async (conn) => {
    // Categories — reuse the starter rows provisioning already created where the
    // slug matches, otherwise add.
    const catIds = {};
    for (const [position, cat] of CATS.entries()) {
      const mediaId = await insertMedia(conn, {
        companyId,
        filename: `${cat.slug}.jpg`,
        buffer: await makeImage({ width: 1200, height: 1200, tone: cat.tone }),
      });

      const existing = await conn.execute(
        'SELECT id FROM cats WHERE company_id = :companyId AND slug = :slug',
        { companyId, slug: cat.slug },
      );

      if (existing.rows.length) {
        catIds[cat.slug] = existing.rows[0].ID;
        await conn.execute('UPDATE cats SET image_id = :mediaId WHERE id = :id', {
          mediaId,
          id: catIds[cat.slug],
        });
      } else {
        const inserted = await conn.execute(
          `INSERT INTO cats (company_id, name, slug, image_id, position, is_active)
           VALUES (:companyId, :name, :slug, :mediaId, :position, 1) RETURNING id INTO :id`,
          { companyId, name: cat.name, slug: cat.slug, mediaId, position, id: OUT_ID },
        );
        catIds[cat.slug] = inserted.outBinds.id[0];
      }
    }

    for (const [index, product] of PRODUCTS.entries()) {
      const tone = CATS.find((cat) => cat.slug === product.cat).tone;
      const mediaId = await insertMedia(conn, {
        companyId,
        filename: `product-${index}.jpg`,
        buffer: await makeImage({ width: 1400, height: 1400, tone }),
      });

      const productRow = await conn.execute(
        `INSERT INTO products (company_id, name, slug, short_desc, brand, tags, is_active, is_featured)
         VALUES (:companyId, :name, :slug, :short, :brand, :tags, 1, :featured)
         RETURNING id INTO :id`,
        {
          companyId,
          name: product.name,
          slug: product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          short: product.short,
          brand: product.brand,
          tags: JSON.stringify(product.tags),
          featured: product.featured ? 1 : 0,
          id: OUT_ID,
        },
      );
      const productId = productRow.outBinds.id[0];

      await conn.execute(
        `INSERT INTO variants (company_id, product_id, sku, price, sale_price, stock, is_default, is_active)
         VALUES (:companyId, :productId, :sku, :price, :sale, :stock, 1, 1)`,
        {
          companyId,
          productId,
          sku: `SF-${companyId}-${index}`,
          price: product.price,
          sale: product.sale,
          stock: product.stock,
        },
      );

      await conn.execute(
        'INSERT INTO prod_imgs (company_id, product_id, media_id, position) VALUES (:companyId, :productId, :mediaId, 0)',
        { companyId, productId, mediaId },
      );

      await conn.execute(
        'INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)',
        { companyId, productId, catId: catIds[product.cat] },
      );
    }

    // Two banners with a separate mobile crop each, so the hero has something to
    // show and the mobile-crop path is actually exercised.
    const bannerIds = [];
    for (const [index, tone] of [CATS[0].tone, CATS[3].tone].entries()) {
      const wide = await insertMedia(conn, {
        companyId,
        filename: `banner-${index}-wide.jpg`,
        buffer: await makeImage({ width: 2000, height: 900, tone }),
      });
      const tall = await insertMedia(conn, {
        companyId,
        filename: `banner-${index}-mobile.jpg`,
        buffer: await makeImage({ width: 900, height: 1100, tone }),
      });

      const banner = await conn.execute(
        `INSERT INTO banners (company_id, name, media_id, media_mobile_id, link, alt, position, is_active)
         VALUES (:companyId, :name, :wide, :tall, :link, :alt, :position, 1) RETURNING id INTO :id`,
        {
          companyId,
          name: index === 0 ? 'Counter cut fresh' : 'Ready for the grill',
          wide,
          tall,
          link: '/cats/beef',
          alt: index === 0 ? 'Fresh cuts at the counter' : 'Skewers ready for the grill',
          position: index,
          id: OUT_ID,
        },
      );
      bannerIds.push(banner.outBinds.id[0]);
    }

    // Point the home page sections provisioning created at this content.
    const home = await conn.execute(
      `SELECT id FROM pages WHERE company_id = :companyId AND type = 'home'`,
      { companyId },
    );
    if (home.rows.length) {
      const sections = await conn.execute(
        'SELECT id, type, settings FROM sections WHERE company_id = :companyId AND page_id = :pageId',
        { companyId, pageId: home.rows[0].ID },
      );

      for (const section of sections.rows) {
        const settings = JSON.parse(section.SETTINGS ?? '{}');
        if (section.TYPE === 'hero') Object.assign(settings, { bannerIds });
        if (section.TYPE === 'cat_tiles') {
          Object.assign(settings, { title: 'Shop by counter', catIds: Object.values(catIds) });
        }
        if (section.TYPE === 'prod_row') {
          Object.assign(settings, { title: 'Fresh this week', source: 'featured', limit: 8 });
        }
        if (section.TYPE === 'features') {
          Object.assign(settings, {
            items: [
              { mediaId: null, title: 'Cut to order', text: 'Nothing is pre-packed. Every order is cut when you place it.' },
              { mediaId: null, title: 'Same-day collection', text: 'Order before 2pm and collect the same afternoon.' },
              { mediaId: null, title: 'Pay on delivery', text: 'No card details needed. Settle up when it arrives.' },
              { mediaId: null, title: 'Local suppliers', text: 'Sourced from farms we have bought from for years.' },
            ],
          });
        }
        if (section.TYPE === 'news') {
          Object.assign(settings, {
            heading: 'What is good this week',
            subheading: 'One short email each Thursday: what is in, what is on offer, and how to cook it.',
            buttonLabel: 'Subscribe',
          });
        }

        await conn.execute('UPDATE sections SET settings = :settings WHERE id = :id', {
          settings: JSON.stringify(settings),
          id: section.ID,
        });
      }
    }

    await conn.commit();
  });

  console.log(`  ${storeName}: ${PRODUCTS.length} products, ${CATS.length} categories, 2 banners.`);
}

async function run() {
  await initPool();

  const companies = await withPlatform(async (conn) => {
    const result = await conn.execute(
      `SELECT c.id, c.name FROM companies c
        JOIN domains d ON d.company_id = c.id
       WHERE d.host IN ('demo-a.localhost', 'demo-b.localhost')`,
    );
    return result.rows;
  });

  if (companies.length === 0) {
    console.log('No demo stores found. Run npm run seed:demo first.');
    return;
  }

  for (const company of companies) {
    console.log(`Seeding catalog for ${company.NAME} (company ${company.ID})...`);
    await seedStore(company.ID, company.NAME);
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
