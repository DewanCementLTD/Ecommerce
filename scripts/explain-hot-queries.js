import { initPool, closePool, withCompany, withPlatform } from '../api/src/db/pool.js';
import { closeRedis } from '../api/src/lib/redis.js';
import * as productsRepo from '../api/src/modules/products/products.repo.js';
import * as catsRepo from '../api/src/modules/cats/cats.repo.js';
import * as collsRepo from '../api/src/modules/colls/colls.repo.js';
import * as contentRepo from '../api/src/modules/content/content.repo.js';
import * as ordersRepo from '../api/src/modules/orders/orders.repo.js';
import * as i18nRepo from '../api/src/modules/i18n/i18n.repo.js';

/**
 * `EXPLAIN PLAN` for the ten hottest queries in the system, per Phase 3 Task 2.
 *
 * The statements are **not** copied into this file. Copying them would mean a
 * second, slowly-diverging home for SQL that `CLAUDE.md` says lives in exactly
 * one place, and the first repo edit would quietly turn this tool into a
 * report about queries the app no longer runs. Instead each repo function is
 * called for real on a connection whose `execute` has been wrapped to record
 * the statement and its binds — so what gets explained is, by construction,
 * exactly what the application executes.
 *
 * Everything runs on a company-scoped connection (`withCompany`), never the
 * VPD-exempt platform user, because the row-level security predicate is part
 * of the plan: explaining these as a user exempt from VPD would report a plan
 * that no real request ever gets.
 *
 *   node scripts/explain-hot-queries.js [companyId]
 *
 * Exits non-zero if any query full-scans `products`, `orders` or `variants` —
 * the three tables the phase brief names.
 */

const GUARDED_TABLES = new Set(['PRODUCTS', 'ORDERS', 'VARIANTS']);

/** Wraps a connection so every statement it runs is recorded, then replayed. */
function recording(conn, sink) {
  const original = conn.execute.bind(conn);
  return new Proxy(conn, {
    get(target, prop) {
      if (prop === 'execute') {
        return async (sql, binds = {}, opts = {}) => {
          sink.push({ sql, binds });
          return original(sql, binds, opts);
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The ten reads that carry the storefront and the admin. Ordered roughly by
 * how often a running store executes them.
 */
async function hotQueries(conn, { companyId, productId, catId, collId, pageId, menuId }) {
  // 1. Catalog listing — every category page, every search, every product row
  //    section on the home page.
  await productsRepo.listProducts(conn, {
    companyId, page: 1, pageSize: 24, isActive: 1, sort: 'created', dir: 'desc',
  });

  // 2. Product detail by slug.
  await productsRepo.findProductBySlug(conn, { companyId, slug: 'anything', activeOnly: true });

  // 3. Variants for a product (price/stock on the detail page).
  await productsRepo.listVariants(conn, { companyId, productId });

  // 4. The category tree — the header menu and the category tiles section.
  await catsRepo.listCatsForTree(conn, { companyId, isActive: 1 });

  // 5. Category by slug.
  await catsRepo.findCatBySlug(conn, { companyId, slug: 'anything' });

  // 6. Collection membership, including the automatic-rule path.
  await collsRepo.listCollProducts(conn, {
    companyId, collId, isAuto: false, page: 1, pageSize: 24, activeOnly: true,
  });

  // 7. A page's sections — the first query of every home page load.
  await contentRepo.listSections(conn, { companyId, pageId, isActive: 1 });

  // 8. Menu items.
  await contentRepo.listMenuItems(conn, { companyId, menuId, isActive: 1 });

  // 9. Translations, batched per entity type per request.
  await i18nRepo.listTransForEntities(conn, {
    companyId, entity: 'product', entityIds: [productId], langs: ['ar', 'en'],
  });

  // 10. The admin's order list, and the dashboard's headline numbers.
  await ordersRepo.listOrders(conn, { companyId, page: 1, pageSize: 20 });
  await ordersRepo.orderStatsForPeriod(conn, { companyId, from: new Date(Date.now() - 30 * 864e5) });
  await productsRepo.listLowStockVariants(conn, { companyId, threshold: 5, limit: 10 });
}

/** Anything with rows we can point the hot queries at. */
async function pickFixtures(companyId) {
  return withCompany(companyId, async (conn) => {
    const one = async (sql) => (await conn.execute(sql, { companyId })).rows[0] ?? {};
    const product = await one('SELECT id FROM products WHERE company_id = :companyId AND ROWNUM = 1');
    const cat = await one('SELECT id FROM cats WHERE company_id = :companyId AND ROWNUM = 1');
    const coll = await one('SELECT id FROM colls WHERE company_id = :companyId AND ROWNUM = 1');
    const page = await one('SELECT id FROM pages WHERE company_id = :companyId AND ROWNUM = 1');
    const menu = await one('SELECT id FROM menus WHERE company_id = :companyId AND ROWNUM = 1');
    return {
      companyId,
      productId: product.ID ?? 0,
      catId: cat.ID ?? 0,
      collId: coll.ID ?? 0,
      pageId: page.ID ?? 0,
      menuId: menu.ID ?? 0,
    };
  });
}

function summarize(planRows) {
  const operations = [];
  for (const row of planRows) {
    const line = row.PLAN_TABLE_OUTPUT ?? '';
    const match = line.match(/\|\s*\d*\s*\|\s*([A-Z][A-Z $()\-*]+?)\s*\|\s*([A-Z0-9_$#]*)\s*\|/);
    if (match) operations.push({ operation: match[1].trim(), object: match[2].trim() });
  }
  return operations;
}

async function run() {
  const companyId = Number(process.argv[2] ?? 0) || null;

  await initPool();

  const targetId =
    companyId ??
    (await withPlatform(async (conn) => {
      const res = await conn.execute(
        `SELECT company_id, COUNT(*) n FROM products GROUP BY company_id ORDER BY n DESC FETCH FIRST 1 ROWS ONLY`,
      );
      return res.rows[0]?.COMPANY_ID ?? null;
    }));

  if (!targetId) {
    console.error('No company with products found. Run npm run seed:demo-catalog first.');
    process.exitCode = 1;
    return;
  }

  const fixtures = await pickFixtures(targetId);
  const captured = [];

  await withCompany(targetId, async (conn) => {
    await hotQueries(recording(conn, captured), fixtures);
  });

  console.log(`Explaining ${captured.length} statements as company ${targetId}\n`);

  const offenders = [];

  await withCompany(targetId, async (conn) => {
    for (const [index, { sql, binds }] of captured.entries()) {
      const statementId = `hot_${index}`;
      try {
        await conn.execute(`EXPLAIN PLAN SET STATEMENT_ID = '${statementId}' FOR ${sql}`, binds);
      } catch (err) {
        console.log(`${String(index + 1).padStart(2)}. could not explain: ${err.message.split('\n')[0]}`);
        continue;
      }

      const plan = await conn.execute(
        `SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY('plan_table', :statementId, 'BASIC'))`,
        { statementId },
      );

      const operations = summarize(plan.rows);
      const fullScans = operations.filter(
        (op) => op.operation.startsWith('TABLE ACCESS FULL') && op.object,
      );

      const firstLine = sql.trim().split('\n')[0].slice(0, 84);
      const verdict = fullScans.length === 0 ? 'ok' : `FULL SCAN: ${fullScans.map((op) => op.object).join(', ')}`;
      console.log(`${String(index + 1).padStart(2)}. ${verdict.padEnd(28)} ${firstLine}`);

      for (const scan of fullScans) {
        if (GUARDED_TABLES.has(scan.object)) {
          offenders.push({ index: index + 1, table: scan.object, sql: firstLine });
        }
      }

      await conn.execute(`DELETE FROM plan_table WHERE statement_id = :statementId`, { statementId });
    }
    await conn.commit();
  });

  console.log('');
  if (offenders.length === 0) {
    console.log('No full table scans on products, orders or variants.');
  } else {
    console.log('Full table scans on guarded tables:');
    for (const offender of offenders) {
      console.log(`  #${offender.index} ${offender.table} — ${offender.sql}`);
    }
    process.exitCode = 1;
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
