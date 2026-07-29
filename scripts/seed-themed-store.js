/**
 * Provisions a new company on a chosen theme and fills it with a small
 * catalog using real downloaded photographs, instead of the generated
 * gradient placeholders `seed-demo-catalog.js` uses.
 *
 * The images are not committed to the repo or fetched at runtime by the
 * app — they are downloaded once, locally, into a scratch folder, and this
 * script reads them from disk and uploads them through the same path a real
 * admin's browser upload would take (buffer -> sharp resize -> webp variants
 * -> `media` row). Nothing here is a permanent dependency: delete the image
 * folder and the company still works, it just has no pictures.
 *
 * Usage:
 *   node scripts/seed-themed-store.js --name "Aurora Boutique" \
 *     --host aurora.localhost --theme boutique --images <dir> \
 *     --currency USD --admin-email admin@aurora.localhost
 *
 * <dir> must contain banner-1.jpg, category-1..4.jpg, product-1..4.jpg.
 */
import oracledb from 'oracledb';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const { initPool, closePool, withCompany, withPlatform } = await import('../api/src/db/pool.js');
const { closeRedis } = await import('../api/src/lib/redis.js');
const { MEDIA_WIDTHS, MEDIA_FORMATS, writeVariant } = await import('../api/src/lib/mediaStorage.js');
const { provisionCompany } = await import('../api/src/modules/platform/platform.service.js');
const { randomUUID } = await import('node:crypto');

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

const CATALOGS = {
  boutique: {
    cats: [
      { name: 'Dresses', slug: 'dresses' },
      { name: 'Outerwear', slug: 'outerwear' },
      { name: 'Accessories', slug: 'accessories' },
      { name: 'Footwear', slug: 'footwear' },
    ],
    products: [
      { name: 'Linen wrap dress', cat: 'dresses', price: 68, sale: null, stock: 14, brand: 'Aurora', tags: ['summer'], featured: true, short: 'Breathable linen, tie waist, midi length.' },
      { name: 'Tailored wool coat', cat: 'outerwear', price: 145, sale: 119, stock: 6, brand: 'Aurora', tags: ['winter'], featured: true, short: 'Double-breasted, fully lined.' },
      { name: 'Silk scarf', cat: 'accessories', price: 32, sale: null, stock: 22, brand: null, tags: ['gift'], featured: false, short: 'Hand-rolled edges, made in small batches.' },
      { name: 'Leather ankle boots', cat: 'footwear', price: 98, sale: null, stock: 9, brand: 'Aurora', tags: ['autumn'], featured: true, short: 'Full-grain leather, stacked heel.' },
    ],
    homeTitle: 'Shop the edit',
    prodRowTitle: 'New this season',
    features: [
      { title: 'Free returns', text: '30 days to change your mind, no questions asked.' },
      { title: 'Hand-finished', text: 'Every piece checked before it leaves the studio.' },
      { title: 'Pay on delivery', text: 'No card details needed. Settle up when it arrives.' },
      { title: 'Small batches', text: 'We restock often rather than overproduce.' },
    ],
    newsHeading: 'Be first to know',
    newsSub: 'New arrivals and studio sales, once or twice a month.',
  },
  circuit: {
    cats: [
      { name: 'Laptops', slug: 'laptops' },
      { name: 'Audio', slug: 'audio' },
      { name: 'Smart home', slug: 'smart-home' },
      { name: 'Accessories', slug: 'accessories' },
    ],
    products: [
      { name: '14" ultrabook, 16GB', cat: 'laptops', price: 899, sale: 799, stock: 7, brand: 'Circuit', tags: ['new'], featured: true, short: 'Fanless, all-day battery, 1kg.' },
      { name: 'Noise-cancelling headphones', cat: 'audio', price: 199, sale: null, stock: 18, brand: 'Circuit', tags: ['bestseller'], featured: true, short: '30-hour battery, USB-C fast charge.' },
      { name: 'Smart speaker', cat: 'smart-home', price: 59, sale: null, stock: 25, brand: null, tags: ['home'], featured: false, short: 'Voice control, multi-room audio.' },
      { name: 'USB-C hub, 8-in-1', cat: 'accessories', price: 39, sale: 29, stock: 40, brand: null, tags: ['travel'], featured: true, short: 'HDMI, SD, 100W pass-through.' },
    ],
    homeTitle: 'Shop by category',
    prodRowTitle: 'Trending now',
    features: [
      { title: '2-year warranty', text: 'Every product covered, no extra cost.' },
      { title: 'Fast dispatch', text: 'Ordered before 3pm ships the same day.' },
      { title: 'Pay on delivery', text: 'No card details needed. Settle up when it arrives.' },
      { title: 'Real support', text: 'A person answers, not a bot.' },
    ],
    newsHeading: 'Deals in your inbox',
    newsSub: 'Restocks and price drops, no spam.',
  },
  harvest: {
    cats: [
      { name: 'Fruit & veg', slug: 'fruit-veg' },
      { name: 'Bakery', slug: 'bakery' },
      { name: 'Dairy & eggs', slug: 'dairy-eggs' },
      { name: 'Pantry', slug: 'pantry' },
    ],
    products: [
      { name: 'Heirloom tomatoes, 1kg', cat: 'fruit-veg', price: 5.5, sale: null, stock: 30, brand: null, tags: ['organic'], featured: true, short: 'Vine-ripened, grown without pesticides.' },
      { name: 'Sourdough loaf', cat: 'bakery', price: 4.8, sale: null, stock: 12, brand: 'Harvest', tags: ['fresh'], featured: true, short: 'Baked daily, 24-hour ferment.' },
      { name: 'Free-range eggs, dozen', cat: 'dairy-eggs', price: 3.9, sale: null, stock: 40, brand: null, tags: ['local'], featured: false, short: 'From hens raised on pasture.' },
      { name: 'Cold-pressed olive oil', cat: 'pantry', price: 12.0, sale: 9.5, stock: 20, brand: 'Harvest', tags: ['bestseller'], featured: true, short: 'First cold press, single estate.' },
    ],
    homeTitle: 'Shop the aisles',
    prodRowTitle: 'Picked this week',
    features: [
      { title: 'Same-day delivery', text: 'Order before noon, delivered by evening.' },
      { title: 'Locally grown', text: 'Sourced from farms within 50 miles.' },
      { title: 'Pay on delivery', text: 'No card details needed. Settle up when it arrives.' },
      { title: 'No plastic packs', text: 'Paper and compostable packaging only.' },
    ],
    newsHeading: "What's fresh this week",
    newsSub: 'Seasonal produce and a recipe, every Thursday.',
  },
  butcher: {
    cats: [
      { name: 'Beef', slug: 'beef' },
      { name: 'Lamb', slug: 'lamb' },
      { name: 'Poultry', slug: 'poultry' },
      { name: 'Ready to cook', slug: 'ready-to-cook' },
    ],
    products: [
      { name: 'Dry-aged ribeye', cat: 'beef', price: 42.0, sale: null, stock: 12, brand: 'Highland', tags: ['premium'], featured: true, short: '28-day dry-aged, bone in.' },
      { name: 'Lamb kofta', cat: 'lamb', price: 14.0, sale: null, stock: 20, brand: 'Fellside', tags: ['grill'], featured: true, short: 'Hand-rolled with parsley and cumin.' },
      { name: 'Free-range chicken', cat: 'poultry', price: 12.5, sale: null, stock: 16, brand: 'Marsh Farm', tags: ['roast'], featured: false, short: 'Whole bird, about 1.6kg.' },
      { name: 'Marinated skewers', cat: 'ready-to-cook', price: 16.0, sale: null, stock: 9, brand: null, tags: ['grill'], featured: true, short: 'Ready for the grill, six to a pack.' },
    ],
    homeTitle: 'Shop by counter',
    prodRowTitle: 'Fresh this week',
    features: [
      { title: 'Cut to order', text: 'Nothing is pre-packed. Every order is cut when you place it.' },
      { title: 'Same-day collection', text: 'Order before 2pm and collect the same afternoon.' },
      { title: 'Pay on delivery', text: 'No card details needed. Settle up when it arrives.' },
      { title: 'Local suppliers', text: 'Sourced from farms we have bought from for years.' },
    ],
    newsHeading: 'What is good this week',
    newsSub: 'One short email each Thursday: what is in, what is on offer, and how to cook it.',
  },
};

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function insertMediaFromFile(conn, { companyId, filePath, filename }) {
  const buffer = await readFile(filePath);
  const metadata = await sharp(buffer).metadata();
  const storageKey = `${companyId}/${randomUUID()}`;

  for (const width of MEDIA_WIDTHS.filter((w) => w <= (metadata.width ?? w))) {
    for (const format of MEDIA_FORMATS) {
      const resized = sharp(buffer).resize({ width, withoutEnlargement: true });
      const variant =
        format === 'avif'
          ? await resized.avif({ effort: 4 }).toBuffer()
          : await resized.webp().toBuffer();
      await writeVariant(storageKey, width, variant, format);
    }
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

async function run() {
  const name = arg('name');
  const host = arg('host');
  const themeCode = arg('theme');
  const imagesDir = arg('images');
  const currency = arg('currency', 'USD');
  const adminEmail = arg('admin-email', `admin@${(host ?? 'store').replace(/[^a-z0-9.]/gi, '')}`);

  if (!name || !host || !themeCode || !imagesDir || !CATALOGS[themeCode]) {
    console.error(
      'Usage: node scripts/seed-themed-store.js --name "X" --host x.localhost --theme <boutique|circuit|harvest|butcher> --images <dir> [--currency USD] [--admin-email a@b.c]',
    );
    process.exitCode = 1;
    return;
  }

  const catalog = CATALOGS[themeCode];

  await initPool();

  const themeId = await withPlatform(async (conn) => {
    const res = await conn.execute('SELECT id FROM themes WHERE code = :code', { code: themeCode });
    if (res.rows.length === 0) throw new Error(`No theme with code "${themeCode}" — run npm run seed:demo first.`);
    return res.rows[0].ID;
  });

  const existing = await withPlatform(async (conn) => {
    const res = await conn.execute('SELECT company_id FROM domains WHERE host = :host', { host });
    return res.rows[0]?.COMPANY_ID ?? null;
  });

  if (existing) {
    console.log(`${host} already provisioned (company ${existing}). Nothing created.`);
    await closePool();
    await closeRedis();
    return;
  }

  const provisioned = await provisionCompany(
    {
      name,
      domainHost: host,
      adminEmail,
      adminName: 'Admin',
      currency,
      themeId,
      defaultLangCode: 'en',
      defaultLangName: 'English',
    },
    { actorAdminId: null, ip: '127.0.0.1' },
  );

  const companyId = provisioned.company.ID;
  console.log(`Provisioned "${name}" (company ${companyId}) at ${host}, theme ${themeCode}`);
  console.log(`  admin: ${provisioned.admin.email} / ${provisioned.admin.tempPassword}`);

  await withCompany(companyId, async (conn) => {
    const catIds = {};
    for (const [position, cat] of catalog.cats.entries()) {
      const mediaId = await insertMediaFromFile(conn, {
        companyId,
        filePath: path.join(imagesDir, `category-${(position % 4) + 1}.jpg`),
        filename: `${cat.slug}.jpg`,
      });

      const existingCat = await conn.execute(
        'SELECT id FROM cats WHERE company_id = :companyId AND slug = :slug',
        { companyId, slug: cat.slug },
      );
      if (existingCat.rows.length) {
        catIds[cat.slug] = existingCat.rows[0].ID;
        await conn.execute('UPDATE cats SET image_id = :mediaId, name = :name WHERE id = :id', {
          mediaId,
          name: cat.name,
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

    for (const [index, product] of catalog.products.entries()) {
      const mediaId = await insertMediaFromFile(conn, {
        companyId,
        filePath: path.join(imagesDir, `product-${(index % 4) + 1}.jpg`),
        filename: `product-${index}.jpg`,
      });

      const slug = product.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const productRow = await conn.execute(
        `INSERT INTO products (company_id, name, slug, short_desc, brand, tags, is_active, is_featured)
         VALUES (:companyId, :name, :slug, :short, :brand, :tags, 1, :featured)
         RETURNING id INTO :id`,
        {
          companyId,
          name: product.name,
          slug,
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
          sku: `${themeCode.toUpperCase()}-${companyId}-${index}`,
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

    // One real banner from the downloaded photo, used for both the wide and
    // mobile crop — a real admin would upload two different crops, but one
    // photo resized twice is enough for a demo to look finished.
    const bannerWide = await insertMediaFromFile(conn, {
      companyId,
      filePath: path.join(imagesDir, 'banner-1.jpg'),
      filename: 'banner-wide.jpg',
    });
    const bannerTall = await insertMediaFromFile(conn, {
      companyId,
      filePath: path.join(imagesDir, 'banner-1.jpg'),
      filename: 'banner-mobile.jpg',
    });

    const banner = await conn.execute(
      `INSERT INTO banners (company_id, name, media_id, media_mobile_id, link, alt, position, is_active)
       VALUES (:companyId, :name, :wide, :tall, :link, :alt, 0, 1) RETURNING id INTO :id`,
      {
        companyId,
        name: catalog.homeTitle,
        wide: bannerWide,
        tall: bannerTall,
        link: `/cats/${catalog.cats[0].slug}`,
        alt: name,
        id: OUT_ID,
      },
    );
    const bannerIds = [banner.outBinds.id[0]];

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
          Object.assign(settings, { title: catalog.homeTitle, catIds: Object.values(catIds) });
        }
        if (section.TYPE === 'prod_row') {
          Object.assign(settings, { title: catalog.prodRowTitle, source: 'featured', limit: 8 });
        }
        if (section.TYPE === 'features') {
          Object.assign(settings, { items: catalog.features.map((f) => ({ mediaId: null, ...f })) });
        }
        if (section.TYPE === 'news') {
          Object.assign(settings, {
            heading: catalog.newsHeading,
            subheading: catalog.newsSub,
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

  console.log(`  ${catalog.products.length} products, ${catalog.cats.length} categories, 1 banner.`);
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
