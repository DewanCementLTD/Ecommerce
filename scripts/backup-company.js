import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initPool, closePool, withPlatform } from '../api/src/db/pool.js';
import { closeRedis } from '../api/src/lib/redis.js';

/**
 * A complete, restorable export of one company (Phase 3, Task 5).
 *
 * ## What this is, and what it is not
 *
 * This is **not** the platform's disaster-recovery backup. That is RMAN, it
 * covers the whole instance, and it belongs to whoever administers Oracle —
 * see `docs/runbooks/backup-restore.md`. The application's database accounts
 * deliberately hold `CREATE SESSION` and nothing else, so they cannot take or
 * restore an instance-level backup, and giving them the privileges to do so
 * would be a far worse idea than not having this script.
 *
 * What this *is* is a per-tenant export, which covers the failure that is far
 * more likely than losing the server: one client's data being wrong. A bad
 * import, a mistaken bulk delete, a client who wants yesterday back. Restoring
 * a 200GB instance to recover one store's catalogue is not a plan.
 *
 * It also happens to be the only restore drill that can be *performed* rather
 * than described from these accounts — which is the difference between a
 * backup and a hope (`docs/04-PHASE-3-launch.md`: "a backup that hasn't been
 * restored is not a backup").
 *
 *   node scripts/backup-company.js --company 352 [--out backups/]
 *
 * Media files are **not** included: they are on disk, they are far larger than
 * the rows, and they are covered by the file-level backup in the runbook. The
 * export records the media rows, so a restore knows which files it expects.
 */

/**
 * Every company-owned table, in an order a restore can replay top to bottom:
 * a row is only inserted after everything it references. Kept explicit rather
 * than derived from the data dictionary, because a table appearing here is a
 * decision — `logs` is deliberately absent (an audit trail belongs to the
 * platform, not to the tenant, and re-inserting it under new ids would forge
 * history).
 */
export const COMPANY_TABLES = [
  { table: 'langs', parents: [] },
  { table: 'settings', parents: [] },
  { table: 'media', parents: [] },
  { table: 'cats', parents: ['cats'] },
  { table: 'colls', parents: [] },
  { table: 'products', parents: [] },
  { table: 'variants', parents: ['products'] },
  { table: 'options', parents: ['products'] },
  { table: 'prod_imgs', parents: ['products', 'media'] },
  { table: 'prod_cats', parents: ['products', 'cats'] },
  { table: 'coll_prods', parents: ['colls', 'products'] },
  { table: 'pages', parents: [] },
  { table: 'sections', parents: ['pages'] },
  { table: 'banners', parents: ['media'] },
  { table: 'menus', parents: [] },
  { table: 'menu_items', parents: ['menus', 'menu_items'] },
  { table: 'trans', parents: [] },
  { table: 'customers', parents: [] },
  { table: 'addrs', parents: ['customers'] },
  { table: 'orders', parents: ['customers'] },
  { table: 'order_items', parents: ['orders', 'variants'] },
  { table: 'order_log', parents: ['orders'] },
  { table: 'order_seq', parents: [] },
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function run() {
  const companyId = Number(arg('company', 0));
  if (!companyId) {
    console.error('Usage: node scripts/backup-company.js --company <id> [--out <dir>]');
    process.exitCode = 1;
    return;
  }

  const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
  const outDir = path.resolve(arg('out', path.join(rootDir, 'backups')));

  await initPool();

  const dump = await withPlatform(async (conn) => {
    const companyRes = await conn.execute('SELECT * FROM companies WHERE id = :id', { id: companyId });
    if (companyRes.rows.length === 0) {
      throw new Error(`No company with id ${companyId}`);
    }

    const domainsRes = await conn.execute(
      'SELECT * FROM domains WHERE company_id = :id ORDER BY id',
      { id: companyId },
    );
    const adminsRes = await conn.execute(
      'SELECT * FROM admins WHERE company_id = :id ORDER BY id',
      { id: companyId },
    );
    const rolesRes = await conn.execute('SELECT * FROM roles WHERE company_id = :id ORDER BY id', {
      id: companyId,
    });

    const tables = {};
    for (const { table } of COMPANY_TABLES) {
      const res = await conn.execute(
        // No ORDER BY id on prod_cats: it is a link table with a composite
        // primary key and no id column of its own.
        `SELECT * FROM ${table} WHERE company_id = :id`,
        { id: companyId },
      );
      tables[table] = res.rows;
    }

    return {
      formatVersion: 1,
      takenAt: new Date().toISOString(),
      company: companyRes.rows[0],
      domains: domainsRes.rows,
      admins: adminsRes.rows,
      roles: rolesRes.rows,
      tables,
    };
  });

  await mkdir(outDir, { recursive: true });
  const stamp = dump.takenAt.replace(/[:.]/g, '-');
  const file = path.join(outDir, `company-${companyId}-${stamp}.json`);
  await writeFile(file, JSON.stringify(dump, null, 2), 'utf8');

  const counts = Object.entries(dump.tables)
    .filter(([, rows]) => rows.length > 0)
    .map(([table, rows]) => `${table}=${rows.length}`)
    .join(' ');

  console.log(`company ${companyId} (${dump.company.NAME})`);
  console.log(`  domains=${dump.domains.length} admins=${dump.admins.length} ${counts}`);
  console.log(`  written to ${file}`);
}

/*
 * `restore-company.js` imports COMPANY_TABLES from this file — the dependency
 * order is one fact and must have one home. Without this guard that import
 * also *ran* the backup, which is how the first restore attempt began by
 * printing this script's usage message.
 */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  run()
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await closePool();
      await closeRedis();
    });
}
