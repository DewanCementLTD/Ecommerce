import oracledb from 'oracledb';
import { initPool, closePool, withPlatform, withCompany } from '../api/src/db/pool.js';
import { closeRedis } from '../api/src/lib/redis.js';
import { provisionCompany } from '../api/src/modules/platform/platform.service.js';

/**
 * A store with realistic volume, for the Phase 3 performance work.
 *
 * `EXPLAIN PLAN` against the demo store proves almost nothing: with ten
 * products in a table, every plan is cheap and Oracle's optimizer will often
 * pick a full scan *because* that is genuinely the fastest thing to do. The
 * targets in `00-SYSTEM-DESIGN.md §9` are written for 10k products per
 * company, so the plans and the load test both need a store of that shape.
 *
 * Idempotent by host: re-running tops the store up to the requested counts
 * rather than duplicating it. Everything it creates belongs to one company and
 * can be removed with `--drop`.
 *
 *   node scripts/seed-loadtest.js [--products 10000] [--orders 2000] [--drop]
 */

const HOST = 'loadtest.localhost';
const ADMIN_EMAIL = 'admin@loadtest.localhost';
const BATCH = 500;

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : Number(process.argv[index + 1]);
}

const BRANDS = ['Northfield', 'Harbour', 'Cleaver', 'Copper Lane', 'Two Rivers', 'Ashgrove'];
const CUTS = ['Ribeye', 'Sirloin', 'Brisket', 'Shank', 'Fillet', 'Rump', 'Chuck', 'Flank', 'Skirt', 'T-bone'];
const QUALIFIERS = ['grass-fed', 'dry-aged', 'boneless', 'trimmed', 'thick-cut', 'family pack', 'premium'];

async function findCompanyByHost() {
  return withPlatform(async (conn) => {
    const res = await conn.execute('SELECT company_id FROM domains WHERE host = :host', { host: HOST });
    return res.rows[0]?.COMPANY_ID ?? null;
  });
}

async function drop(companyId) {
  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM order_log WHERE company_id = :companyId',
      'DELETE FROM order_items WHERE company_id = :companyId',
      'DELETE FROM orders WHERE company_id = :companyId',
      'DELETE FROM order_seq WHERE company_id = :companyId',
      'DELETE FROM cart_items WHERE company_id = :companyId',
      'DELETE FROM carts WHERE company_id = :companyId',
      'DELETE FROM addrs WHERE company_id = :companyId',
      'DELETE FROM customers WHERE company_id = :companyId',
      'DELETE FROM coll_prods WHERE company_id = :companyId',
      'DELETE FROM colls WHERE company_id = :companyId',
      'DELETE FROM prod_cats WHERE company_id = :companyId',
      'DELETE FROM prod_imgs WHERE company_id = :companyId',
      'DELETE FROM options WHERE company_id = :companyId',
      'DELETE FROM variants WHERE company_id = :companyId',
      'DELETE FROM products WHERE company_id = :companyId',
      'DELETE FROM sections WHERE company_id = :companyId',
      'DELETE FROM banners WHERE company_id = :companyId',
      'DELETE FROM menu_items WHERE company_id = :companyId',
      'DELETE FROM menus WHERE company_id = :companyId',
      'DELETE FROM pages WHERE company_id = :companyId',
      'DELETE FROM cats WHERE company_id = :companyId',
      'DELETE FROM trans WHERE company_id = :companyId',
      'DELETE FROM langs WHERE company_id = :companyId',
      'DELETE FROM settings WHERE company_id = :companyId',
      'DELETE FROM media WHERE company_id = :companyId',
      'DELETE FROM logs WHERE company_id = :companyId',
      'DELETE FROM admins WHERE company_id = :companyId',
      'DELETE FROM domains WHERE company_id = :companyId',
      'DELETE FROM companies WHERE id = :companyId',
    ]) {
      await conn.execute(sql, { companyId });
    }
    await conn.commit();
  });
  console.log(`dropped load-test company ${companyId}`);
}

async function ensureCompany() {
  const existing = await findCompanyByHost();
  if (existing) return existing;

  const result = await provisionCompany(
    {
      name: 'Load Test Store',
      domainHost: HOST,
      adminEmail: ADMIN_EMAIL,
      adminName: 'Load Test Admin',
      currency: 'BDT',
      defaultLangCode: 'en',
      defaultLangName: 'English',
    },
    { actorAdminId: null, ip: '127.0.0.1' },
  );
  console.log(`provisioned ${HOST} as company ${result.company.ID}`);
  return result.company.ID;
}

async function seedCats(conn, companyId, wanted) {
  const existing = await conn.execute(
    'SELECT id FROM cats WHERE company_id = :companyId ORDER BY id',
    { companyId },
  );
  const ids = existing.rows.map((row) => row.ID);
  if (ids.length >= wanted) return ids;

  const rows = [];
  for (let i = ids.length; i < wanted; i += 1) {
    rows.push({ companyId, name: `Aisle ${i + 1}`, slug: `aisle-${i + 1}`, position: i });
  }

  await conn.executeMany(
    `INSERT INTO cats (company_id, name, slug, position, is_active)
     VALUES (:companyId, :name, :slug, :position, 1)`,
    rows,
    { autoCommit: false },
  );
  await conn.commit();

  const after = await conn.execute('SELECT id FROM cats WHERE company_id = :companyId ORDER BY id', {
    companyId,
  });
  return after.rows.map((row) => row.ID);
}

async function seedProducts(conn, companyId, wanted, catIds) {
  const countRes = await conn.execute(
    'SELECT COUNT(*) AS n FROM products WHERE company_id = :companyId',
    { companyId },
  );
  let have = countRes.rows[0].N;
  if (have >= wanted) {
    console.log(`products: ${have} already, nothing to add`);
    return;
  }

  console.log(`products: ${have} -> ${wanted}`);

  while (have < wanted) {
    const size = Math.min(BATCH, wanted - have);
    const products = [];

    for (let i = 0; i < size; i += 1) {
      const n = have + i + 1;
      const cut = CUTS[n % CUTS.length];
      const qualifier = QUALIFIERS[n % QUALIFIERS.length];
      products.push({
        companyId,
        name: `${cut} ${qualifier} #${n}`,
        slug: `${cut.toLowerCase()}-${qualifier.replace(/ /g, '-')}-${n}`,
        shortDesc: `${qualifier} ${cut.toLowerCase()}, cut to order.`,
        brand: BRANDS[n % BRANDS.length],
        isFeatured: n % 25 === 0 ? 1 : 0,
        tags: JSON.stringify([cut.toLowerCase(), qualifier.split(' ')[0]]),
      });
    }

    const inserted = await conn.executeMany(
      `INSERT INTO products (company_id, name, slug, short_desc, brand, is_active, is_featured, tags)
       VALUES (:companyId, :name, :slug, :shortDesc, :brand, 1, :isFeatured, :tags)
       RETURNING id INTO :id`,
      products,
      {
        autoCommit: false,
        // executeMany with a RETURNING clause needs every bind described up
        // front — it cannot infer types from the first row the way execute()
        // does, and an OUT bind expressed per-row is rejected outright
        // (NJS-012).
        bindDefs: {
          companyId: { type: oracledb.NUMBER },
          name: { type: oracledb.STRING, maxSize: 300 },
          slug: { type: oracledb.STRING, maxSize: 300 },
          shortDesc: { type: oracledb.STRING, maxSize: 1000 },
          brand: { type: oracledb.STRING, maxSize: 200 },
          isFeatured: { type: oracledb.NUMBER },
          tags: { type: oracledb.STRING, maxSize: 4000 },
          id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
      },
    );

    const productIds = inserted.outBinds.map((bind) => bind.id[0]);

    await conn.executeMany(
      `INSERT INTO variants (company_id, product_id, sku, price, sale_price, stock, is_default, is_active)
       VALUES (:companyId, :productId, :sku, :price, :salePrice, :stock, 1, 1)`,
      productIds.map((productId, i) => {
        const n = have + i + 1;
        const price = 8 + ((n * 7) % 90);
        return {
          companyId,
          productId,
          sku: `LT-${companyId}-${n}`,
          price,
          salePrice: n % 6 === 0 ? Math.round(price * 0.85 * 100) / 100 : null,
          stock: n % 17 === 0 ? 0 : 5 + (n % 40),
        };
      }),
      { autoCommit: false },
    );

    await conn.executeMany(
      `INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)`,
      productIds.map((productId, i) => ({
        companyId,
        productId,
        catId: catIds[(have + i) % catIds.length],
      })),
      { autoCommit: false },
    );

    await conn.commit();
    have += size;
    process.stdout.write(`\r  ${have}/${wanted}`);
  }
  process.stdout.write('\n');
}

async function seedOrders(conn, companyId, wanted) {
  const countRes = await conn.execute(
    'SELECT COUNT(*) AS n FROM orders WHERE company_id = :companyId',
    { companyId },
  );
  let have = countRes.rows[0].N;
  if (have >= wanted) {
    console.log(`orders: ${have} already, nothing to add`);
    return;
  }

  console.log(`orders: ${have} -> ${wanted}`);

  const customerRes = await conn.execute(
    `INSERT INTO customers (company_id, name, phone, email, is_active)
     VALUES (:companyId, 'Load Test Buyer', :phone, :email, 1) RETURNING id INTO :id`,
    { companyId, phone: `0170000${companyId}`, email: `buyer-${companyId}@loadtest.localhost`, id: OUT_ID },
  ).catch(async () => {
    const existing = await conn.execute(
      'SELECT id FROM customers WHERE company_id = :companyId AND ROWNUM = 1',
      { companyId },
    );
    return { outBinds: { id: [existing.rows[0].ID] } };
  });
  const customerId = customerRes.outBinds.id[0];

  const variants = await conn.execute(
    `SELECT v.id, v.product_id, v.sku, v.price, p.name
       FROM variants v JOIN products p ON p.company_id = v.company_id AND p.id = v.product_id
      WHERE v.company_id = :companyId AND ROWNUM <= 200`,
    { companyId },
  );

  const statuses = ['new', 'confirmed', 'delivered', 'cancelled'];

  while (have < wanted) {
    const size = Math.min(BATCH, wanted - have);
    const orders = [];

    for (let i = 0; i < size; i += 1) {
      const n = have + i + 1;
      const variant = variants.rows[n % variants.rows.length];
      const qty = 1 + (n % 3);
      orders.push({
        companyId,
        customerId,
        orderNo: n,
        status: statuses[n % statuses.length],
        subtotal: variant.PRICE * qty,
        total: variant.PRICE * qty,
        daysAgo: n % 90,
      });
    }

    const inserted = await conn.executeMany(
      `INSERT INTO orders (company_id, order_no, customer_id, status, name, phone, address,
                           subtotal, discount, total, currency, placed_at)
       VALUES (:companyId, :orderNo, :customerId, :status, 'Load Test Buyer', '01700000000',
               '{"line1":"1 Test Road","city":"Dhaka"}',
               :subtotal, 0, :total, 'BDT', SYSTIMESTAMP - NUMTODSINTERVAL(:daysAgo, 'DAY'))
       RETURNING id INTO :id`,
      orders,
      {
        autoCommit: false,
        bindDefs: {
          companyId: { type: oracledb.NUMBER },
          orderNo: { type: oracledb.NUMBER },
          customerId: { type: oracledb.NUMBER },
          status: { type: oracledb.STRING, maxSize: 20 },
          subtotal: { type: oracledb.NUMBER },
          total: { type: oracledb.NUMBER },
          daysAgo: { type: oracledb.NUMBER },
          id: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
      },
    );

    const orderIds = inserted.outBinds.map((bind) => bind.id[0]);

    await conn.executeMany(
      `INSERT INTO order_items (company_id, order_id, variant_id, sku, name_snap, price_snap, qty, line_total)
       VALUES (:companyId, :orderId, :variantId, :sku, :nameSnap, :priceSnap, :qty, :lineTotal)`,
      orderIds.map((orderId, i) => {
        const n = have + i + 1;
        const variant = variants.rows[n % variants.rows.length];
        const qty = 1 + (n % 3);
        return {
          companyId,
          orderId,
          variantId: variant.ID,
          sku: variant.SKU,
          nameSnap: variant.NAME,
          priceSnap: variant.PRICE,
          qty,
          lineTotal: variant.PRICE * qty,
        };
      }),
      { autoCommit: false },
    );

    await conn.commit();
    have += size;
    process.stdout.write(`\r  ${have}/${wanted}`);
  }
  process.stdout.write('\n');
}

/**
 * Filler tenants: other companies' orders, so no single company owns the whole
 * table.
 *
 * This exists because of something `EXPLAIN PLAN` showed the first time it was
 * run. With one load-test store and nothing else, `orders` held 2,000 rows and
 * every one of them belonged to that store — so `WHERE company_id = :1`
 * selected 100% of the table and Oracle full-scanned it, entirely correctly.
 * No index can beat reading a table you need all of. "No full table scans on
 * orders" is only a meaningful criterion when a tenant is a *minority* of the
 * rows, which is what production looks like and what this reproduces.
 *
 * Orders only — no products, no items. The point is row count in one table.
 */
async function seedFillerTenants(count, ordersEach) {
  for (let i = 1; i <= count; i += 1) {
    const host = `filler-${i}.localhost`;
    let companyId = await withPlatform(async (conn) => {
      const res = await conn.execute('SELECT company_id FROM domains WHERE host = :host', { host });
      return res.rows[0]?.COMPANY_ID ?? null;
    });

    if (!companyId) {
      const result = await provisionCompany(
        {
          name: `Filler Store ${i}`,
          domainHost: host,
          adminEmail: `admin@${host}`,
          adminName: 'Filler Admin',
          currency: 'BDT',
          defaultLangCode: 'en',
          defaultLangName: 'English',
        },
        { actorAdminId: null, ip: '127.0.0.1' },
      );
      companyId = result.company.ID;
    }

    await withCompany(companyId, async (conn) => {
      const existing = await conn.execute(
        'SELECT COUNT(*) AS n FROM orders WHERE company_id = :companyId',
        { companyId },
      );
      let have = existing.rows[0].N;
      if (have >= ordersEach) return;

      const customer = await conn.execute(
        `SELECT id FROM customers WHERE company_id = :companyId AND ROWNUM = 1`,
        { companyId },
      );
      const customerId =
        customer.rows[0]?.ID ??
        (
          await conn.execute(
            `INSERT INTO customers (company_id, name, phone, is_active)
             VALUES (:companyId, 'Filler Buyer', :phone, 1) RETURNING id INTO :id`,
            { companyId, phone: `0180000${companyId}`, id: OUT_ID },
          )
        ).outBinds.id[0];
      await conn.commit();

      const statuses = ['new', 'confirmed', 'delivered', 'cancelled'];
      while (have < ordersEach) {
        const size = Math.min(BATCH, ordersEach - have);
        const rows = [];
        for (let j = 0; j < size; j += 1) {
          const n = have + j + 1;
          rows.push({
            companyId,
            orderNo: n,
            customerId,
            status: statuses[n % statuses.length],
            subtotal: 10 + (n % 50),
            total: 10 + (n % 50),
            daysAgo: n % 120,
          });
        }
        await conn.executeMany(
          `INSERT INTO orders (company_id, order_no, customer_id, status, name, phone, address,
                               subtotal, discount, total, currency, placed_at)
           VALUES (:companyId, :orderNo, :customerId, :status, 'Filler Buyer', '01800000000',
                   '{"line1":"1 Filler Road","city":"Dhaka"}',
                   :subtotal, 0, :total, 'BDT', SYSTIMESTAMP - NUMTODSINTERVAL(:daysAgo, 'DAY'))`,
          rows,
          { autoCommit: false },
        );
        await conn.commit();
        have += size;
      }
    });

    console.log(`filler tenant ${i}: company ${companyId}, ${ordersEach} orders`);
  }
}

/**
 * Without fresh statistics the optimizer still believes these tables hold the
 * handful of rows they had when they were created, and every plan it produces
 * is an answer to the wrong question.
 */
async function gatherStats(companyId) {
  /*
   * Gathered as the *company* user, not the platform one. The platform user
   * reaches these tables through synonyms, and DBMS_STATS resolves the name
   * against its own schema — where nothing of that name exists (ORA-20000).
   */
  await withCompany(companyId, async (conn) => {
    const owner = (await conn.execute('SELECT USER AS u FROM dual')).rows[0].U;
    for (const table of ['PRODUCTS', 'VARIANTS', 'PROD_CATS', 'ORDERS', 'ORDER_ITEMS', 'CATS']) {
      await conn.execute(
        `BEGIN DBMS_STATS.GATHER_TABLE_STATS(ownname => :owner, tabname => :table, cascade => TRUE); END;`,
        { owner, table },
      ).catch((err) => console.warn(`stats ${table}: ${err.message.split('\n')[0]}`));
    }
  });
  console.log('gathered table statistics');
}

async function run() {
  await initPool();

  if (process.argv.includes('--drop')) {
    const companyId = await findCompanyByHost();
    if (companyId) await drop(companyId);
    else console.log('no load-test company to drop');

    for (let i = 1; i <= 20; i += 1) {
      const fillerId = await withPlatform(async (conn) => {
        const res = await conn.execute('SELECT company_id FROM domains WHERE host = :host', {
          host: `filler-${i}.localhost`,
        });
        return res.rows[0]?.COMPANY_ID ?? null;
      });
      if (fillerId) await drop(fillerId);
    }
    return;
  }

  const products = arg('products', 10000);
  const orders = arg('orders', 2000);
  const companyId = await ensureCompany();

  await withCompany(companyId, async (conn) => {
    const catIds = await seedCats(conn, companyId, 40);
    await seedProducts(conn, companyId, products, catIds);
    await seedOrders(conn, companyId, orders);
  });

  const filler = arg('filler', 5);
  if (filler > 0) await seedFillerTenants(filler, 4000);

  await gatherStats(companyId);
  console.log(`\nload-test store ready: http://${HOST}:4000  (company ${companyId})`);
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
