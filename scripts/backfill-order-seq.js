import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const { initPool, closePool, withPlatform } = await import('../api/src/db/pool.js');

/**
 * One-time (idempotent), for any company provisioned before 007_commerce.sql
 * added the order_seq step to provisionCompany. Safe to run repeatedly —
 * only inserts rows for companies that don't have one yet.
 */
async function run() {
  await initPool();
  const inserted = await withPlatform(async (conn) => {
    const result = await conn.execute(
      `INSERT INTO order_seq (company_id)
       SELECT c.id FROM companies c
        WHERE NOT EXISTS (SELECT 1 FROM order_seq os WHERE os.company_id = c.id)`,
    );
    await conn.commit();
    return result.rowsAffected;
  });
  console.log(`Backfilled order_seq for ${inserted} compan${inserted === 1 ? 'y' : 'ies'}.`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
