import { readFile } from 'node:fs/promises';
import oracledb from 'oracledb';
import { initPool, closePool, withPlatform } from '../api/src/db/pool.js';
import { closeRedis } from '../api/src/lib/redis.js';
import { COMPANY_TABLES } from './backup-company.js';

/**
 * Restores a company export (`backup-company.js`) into a **new** company.
 *
 * Restoring over the original is deliberately not offered. A restore that
 * overwrites is a restore you cannot check before trusting: the moment it
 * runs, the thing you would compare against is gone. Restoring alongside means
 * the drill can end with both rows present and counted, and a real recovery
 * ends with a human looking at the restored store and *then* repointing the
 * domain — which takes seconds and is reversible.
 *
 *   node scripts/restore-company.js --file backups/company-352-….json \
 *     [--name "Demo Store A (restored)"] [--host restored.example.com] [--drop]
 *
 * `--drop` removes a previously restored copy created from the same file,
 * which is what makes the drill repeatable.
 *
 * ## Identity columns and id remapping
 *
 * Every table's `id` is `GENERATED ALWAYS AS IDENTITY`, so the original ids
 * cannot be reinserted — Oracle refuses even to be told. Each row is inserted
 * without its id, the new id is read back, and a per-table map from old to new
 * rewrites every foreign key before its children are inserted. That is why
 * `COMPANY_TABLES` is ordered by dependency and why self-referencing tables
 * (`cats.parent_id`, `menu_items.parent_id`) are patched in a second pass
 * once every row in that table exists.
 */

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/** Columns holding a foreign key, and which table's map rewrites them. */
const FK_COLUMNS = {
  CAT_ID: 'cats',
  PARENT_ID: null, // self-referencing; handled in the second pass
  PRODUCT_ID: 'products',
  VARIANT_ID: 'variants',
  COLL_ID: 'colls',
  MEDIA_ID: 'media',
  IMAGE_ID: 'media',
  OG_IMAGE_ID: 'media',
  // The column is `media_mobile_id`, not `mobile_media_id` — getting this
  // name wrong left the id pointing at the *source* company's media row and
  // Oracle refused the insert (ORA-02291). Worth the reminder that this map
  // is matched by exact column name, not by guessing at a convention.
  MEDIA_MOBILE_ID: 'media',
  PAGE_ID: 'pages',
  MENU_ID: 'menus',
  CUSTOMER_ID: 'customers',
  ORDER_ID: 'orders',
  ADDR_ID: 'addrs',
};

/** Columns never carried across: identity, tenancy, and audit ownership. */
const SKIP_COLUMNS = new Set(['ID', 'COMPANY_ID', 'ADMIN_ID']);

const SELF_PARENT = { cats: 'cats', menu_items: 'menu_items' };

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

/**
 * JSON has no date type.
 *
 * Every `TIMESTAMP WITH TIME ZONE` came out of `JSON.stringify` as an ISO
 * string, and binding a string where Oracle wants a timestamp makes it try to
 * parse it with the session's NLS format — `ORA-01843: not a valid month`,
 * which is what the first run of this script produced. Columns are named by
 * convention (`created_at`, `placed_at`, `expires_at`), so the name is a
 * reliable signal, and the value is checked against a strict ISO pattern
 * rather than trusting the name alone.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function bindable(column, value) {
  if (value === undefined) return null;
  if (typeof value === 'string' && column.endsWith('_AT') && ISO_DATE.test(value)) {
    return new Date(value);
  }
  return value;
}

async function insertRow(conn, { table, row, companyId, sourceCompanyId, maps }) {
  const columns = [];
  const binds = { companyId };

  for (const [column, value] of Object.entries(row)) {
    if (SKIP_COLUMNS.has(column)) continue;

    let mapped = value;
    const fkTable = FK_COLUMNS[column];
    if (fkTable && value !== null && maps[fkTable]) {
      mapped = maps[fkTable].get(value) ?? null;
    }

    /*
     * `media.storage_key` is globally unique — deliberately, since two rows
     * pointing at one file on disk would make deleting either one destroy the
     * other's image. It is also `{companyId}/{uuid}`, so the restored copy
     * gets its own namespace with the uuid preserved: the accompanying file
     * copy is then a plain directory move, `media/{old}/` → `media/{new}/`,
     * and every filename still lines up.
     */
    if (table === 'media' && column === 'STORAGE_KEY' && typeof mapped === 'string') {
      mapped = mapped.replace(new RegExp(`^${sourceCompanyId}/`), `${companyId}/`);
    }
    // A self-referencing parent is left null here and filled in afterwards,
    // once every row of this table has an id.
    if (column === 'PARENT_ID') mapped = null;

    columns.push(column);
    binds[column] = bindable(column, mapped);
  }

  const columnList = ['company_id', ...columns].join(', ');
  const valueList = [':companyId', ...columns.map((column) => `:${column}`)].join(', ');

  // prod_cats and coll_prods have no identity column to return.
  const hasId = Object.hasOwn(row, 'ID');
  const sql = hasId
    ? `INSERT INTO ${table} (${columnList}) VALUES (${valueList}) RETURNING id INTO :newId`
    : `INSERT INTO ${table} (${columnList}) VALUES (${valueList})`;

  if (hasId) binds.newId = OUT_ID;

  const result = await conn.execute(sql, binds);
  return hasId ? result.outBinds.newId[0] : null;
}

async function dropRestored(conn, companyId) {
  for (const { table } of [...COMPANY_TABLES].reverse()) {
    await conn.execute(`DELETE FROM ${table} WHERE company_id = :id`, { id: companyId });
  }
  for (const sql of [
    'DELETE FROM logs WHERE company_id = :id',
    'DELETE FROM admins WHERE company_id = :id',
    'DELETE FROM domains WHERE company_id = :id',
    'DELETE FROM companies WHERE id = :id',
  ]) {
    await conn.execute(sql, { id: companyId });
  }
  await conn.commit();
}

async function run() {
  const file = arg('file');
  if (!file) {
    console.error('Usage: node scripts/restore-company.js --file <export.json> [--name X] [--host Y] [--drop]');
    process.exitCode = 1;
    return;
  }

  const dump = JSON.parse(await readFile(file, 'utf8'));
  const original = dump.company;
  const name = arg('name', `${original.NAME} (restored)`);
  const host = arg('host', null);

  await initPool();

  if (process.argv.includes('--drop')) {
    const removed = await withPlatform(async (conn) => {
      const res = await conn.execute('SELECT id FROM companies WHERE name = :name', { name });
      for (const row of res.rows) await dropRestored(conn, row.ID);
      return res.rows.map((row) => row.ID);
    });
    console.log(removed.length ? `dropped restored company/companies ${removed.join(', ')}` : 'nothing to drop');
    return;
  }

  const summary = await withPlatform(async (conn) => {
    try {
      const companyRes = await conn.execute(
        `INSERT INTO companies (name, biz_name, email, phone, currency, timezone, theme_id, status)
         VALUES (:name, :bizName, :email, :phone, :currency, :timezone, :themeId, :status)
         RETURNING id INTO :newId`,
        {
          name,
          bizName: original.BIZ_NAME,
          email: original.EMAIL,
          phone: original.PHONE,
          currency: original.CURRENCY,
          timezone: original.TIMEZONE,
          themeId: original.THEME_ID,
          // A restored copy starts suspended. It exists to be inspected, and a
          // second live store answering with the same catalogue while someone
          // decides whether the restore is good is not a state worth risking.
          status: 'suspended',
          newId: OUT_ID,
        },
      );
      const companyId = companyRes.outBinds.newId[0];

      if (host) {
        await conn.execute(
          'INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)',
          { companyId, host },
        );
      }

      const sourceCompanyId = original.ID;
      const maps = {};
      const counts = {};

      for (const { table } of COMPANY_TABLES) {
        const rows = dump.tables[table] ?? [];
        maps[table] = new Map();
        for (const row of rows) {
          const newId = await insertRow(conn, { table, row, companyId, sourceCompanyId, maps });
          if (newId !== null) maps[table].set(row.ID, newId);
        }
        counts[table] = rows.length;
      }

      // Second pass: self-referencing parents, now that every id exists.
      for (const [table, mapName] of Object.entries(SELF_PARENT)) {
        for (const row of dump.tables[table] ?? []) {
          if (row.PARENT_ID === null || row.PARENT_ID === undefined) continue;
          const newId = maps[table].get(row.ID);
          const newParent = maps[mapName].get(row.PARENT_ID) ?? null;
          if (newId && newParent) {
            await conn.execute(
              `UPDATE ${table} SET parent_id = :parentId WHERE company_id = :companyId AND id = :id`,
              { parentId: newParent, companyId, id: newId },
            );
          }
        }
      }

      await conn.commit();
      return { companyId, counts };
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });

  console.log(`restored "${name}" as company ${summary.companyId} (suspended)`);
  const restored = Object.entries(summary.counts)
    .filter(([, n]) => n > 0)
    .map(([table, n]) => `${table}=${n}`)
    .join(' ');
  console.log(`  ${restored}`);
  console.log(`  Verify with: node scripts/verify-restore.js --file ${file} --company ${summary.companyId}`);

  if (summary.counts.media > 0) {
    // The rows are restored; the bytes are not. Saying so explicitly, with the
    // exact command, is the difference between a restore that works and a
    // store full of broken images that looked fine in a row count.
    console.log('');
    console.log(`  ${summary.counts.media} media rows were restored. Copy the files too:`);
    console.log(
      `    robocopy media\\${original.ID} media\\${summary.companyId} /E     (Windows)`,
    );
    console.log(`    cp -r media/${original.ID} media/${summary.companyId}            (Linux)`);
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
