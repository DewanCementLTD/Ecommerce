import { readFile } from 'node:fs/promises';
import { initPool, closePool, withPlatform } from '../api/src/db/pool.js';
import { closeRedis } from '../api/src/lib/redis.js';
import { COMPANY_TABLES } from './backup-company.js';

/**
 * Checks a restored company against the export it came from.
 *
 * This is the part that turns a restore into a *drill*. "The script ran
 * without errors" is not evidence — a script that inserted half the rows and
 * committed also runs without errors. This compares row counts per table, and
 * then compares the content of the rows a store is actually judged by: product
 * names and slugs, prices, category names, and order totals.
 *
 *   node scripts/verify-restore.js --file backups/company-352-….json --company 7734
 *
 * Exits non-zero on any mismatch, so it can gate a runbook step.
 */

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

/** Fields worth comparing by value, per table. Ids are expected to differ. */
const CONTENT_CHECKS = {
  products: ['NAME', 'SLUG', 'SHORT_DESC', 'BRAND', 'IS_ACTIVE'],
  variants: ['SKU', 'PRICE', 'SALE_PRICE', 'STOCK'],
  cats: ['NAME', 'SLUG', 'POSITION', 'IS_ACTIVE'],
  pages: ['TITLE', 'SLUG', 'TYPE'],
  sections: ['TYPE', 'POSITION', 'IS_ACTIVE'],
  menu_items: ['LABEL', 'LINK_TYPE', 'POSITION'],
  settings: ['KEY'],
  orders: ['ORDER_NO', 'STATUS', 'TOTAL'],
  order_items: ['NAME_SNAP', 'PRICE_SNAP', 'QTY', 'LINE_TOTAL'],
  customers: ['NAME', 'PHONE', 'EMAIL'],
};

/** An unlikely separator, so two fields cannot join into a third by accident. */
const FIELD_SEP = ' ‖ ';

function fingerprint(row, fields) {
  return fields
    .map((field) => {
      const value = row[field];
      if (value === null || value === undefined) return '';
      if (value instanceof Date) return value.toISOString();
      return String(value);
    })
    .join(FIELD_SEP);
}

async function run() {
  const file = arg('file');
  const companyId = Number(arg('company', 0));

  if (!file || !companyId) {
    console.error('Usage: node scripts/verify-restore.js --file <export.json> --company <restoredId>');
    process.exitCode = 1;
    return;
  }

  const dump = JSON.parse(await readFile(file, 'utf8'));

  await initPool();

  const problems = [];
  let checkedRows = 0;

  await withPlatform(async (conn) => {
    for (const { table } of COMPANY_TABLES) {
      const expected = dump.tables[table] ?? [];
      const res = await conn.execute(`SELECT * FROM ${table} WHERE company_id = :id`, { id: companyId });
      const actual = res.rows;

      if (expected.length !== actual.length) {
        problems.push(`${table}: expected ${expected.length} rows, found ${actual.length}`);
        continue;
      }

      const fields = CONTENT_CHECKS[table];
      if (!fields || expected.length === 0) continue;

      // Compared as multisets: the restore is not required to preserve
      // physical order, only content.
      const expectedPrints = expected.map((row) => fingerprint(row, fields)).sort();
      const actualPrints = actual.map((row) => fingerprint(row, fields)).sort();

      for (let i = 0; i < expectedPrints.length; i += 1) {
        checkedRows += 1;
        if (expectedPrints[i] !== actualPrints[i]) {
          problems.push(
            `${table}: row content differs\n    expected ${expectedPrints[i]}\n    found    ${actualPrints[i]}`,
          );
          break;
        }
      }
    }

    // Referential integrity: the restore rewrites every foreign key, and a
    // rewrite that produced an orphan would still have the right row counts.
    const orphans = await conn.execute(
      `SELECT 'variants' AS t, COUNT(*) AS n FROM variants v
        WHERE v.company_id = :id
          AND NOT EXISTS (SELECT 1 FROM products p WHERE p.company_id = v.company_id AND p.id = v.product_id)
       UNION ALL
       SELECT 'sections', COUNT(*) FROM sections s
        WHERE s.company_id = :id
          AND NOT EXISTS (SELECT 1 FROM pages p WHERE p.company_id = s.company_id AND p.id = s.page_id)
       UNION ALL
       SELECT 'prod_cats', COUNT(*) FROM prod_cats pc
        WHERE pc.company_id = :id
          AND NOT EXISTS (SELECT 1 FROM cats c WHERE c.company_id = pc.company_id AND c.id = pc.cat_id)
       UNION ALL
       SELECT 'order_items', COUNT(*) FROM order_items oi
        WHERE oi.company_id = :id
          AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.company_id = oi.company_id AND o.id = oi.order_id)`,
      { id: companyId },
    );

    for (const row of orphans.rows) {
      if (row.N > 0) problems.push(`${row.T}: ${row.N} row(s) point at a parent that does not exist`);
    }
  });

  const tables = COMPANY_TABLES.filter(({ table }) => (dump.tables[table] ?? []).length > 0).length;

  if (problems.length === 0) {
    console.log(`PASS  company ${companyId} matches ${file}`);
    console.log(`      ${tables} non-empty tables, ${checkedRows} rows compared by content, no orphans`);
  } else {
    console.log(`FAIL  company ${companyId} does not match ${file}`);
    for (const problem of problems) console.log(`  - ${problem}`);
    process.exitCode = 1;
  }
}

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
    await closeRedis();
  });
