import oracledb from 'oracledb';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

const migrationsDir = path.join(rootDir, 'api/src/db/migrations');
const isDryRun = process.argv.includes('--dry-run');

function splitStatements(sql) {
  return sql
    .split(/^[ \t]*\/[ \t]*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function getAppliedMigrations(conn) {
  try {
    const result = await conn.execute('SELECT filename FROM migrations');
    return new Set(result.rows.map((row) => row.FILENAME));
  } catch (err) {
    if (err.errorNum === 942) return new Set();
    throw err;
  }
}

async function run() {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_DSN,
  });

  try {
    const applied = await getAppliedMigrations(conn);
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    if (isDryRun) {
      console.log('Pending migrations (dry run, nothing executed):');
      for (const file of pending) console.log(`  ${file}`);
      return;
    }

    for (const file of pending) {
      console.log(`Applying ${file}...`);
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      const statements = splitStatements(sql);

      // Oracle DDL auto-commits before and after each statement, so this loop
      // cannot roll back earlier statements in the same file if a later one
      // fails — only the final bookkeeping INSERT below is a real transaction.
      // A partial failure needs a follow-up migration or manual cleanup before
      // re-running.
      for (const statement of statements) {
        await conn.execute(statement);
      }

      await conn.execute('INSERT INTO migrations (filename) VALUES (:filename)', {
        filename: file,
      });
      await conn.commit();
      console.log(`Applied ${file}`);
    }
  } finally {
    await conn.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
