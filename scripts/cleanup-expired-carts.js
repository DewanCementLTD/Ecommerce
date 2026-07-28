import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const { initPool, closePool, withPlatform } = await import('../api/src/db/pool.js');

/**
 * Expires carts past their 30-day window, across every company in one pass —
 * intentionally run via withPlatform rather than per-company, since this is
 * platform maintenance, not a tenant-scoped request. cart_items cascade on
 * cart delete (007_commerce.sql), so one DELETE is enough.
 *
 * No cron exists on this dev host; run by hand or wire into whatever
 * scheduler (Task Scheduler / cron) the production box ends up using.
 */
async function run() {
  await initPool();
  const deleted = await withPlatform(async (conn) => {
    const result = await conn.execute('DELETE FROM carts WHERE expires_at < SYSTIMESTAMP');
    await conn.commit();
    return result.rowsAffected;
  });
  console.log(`Removed ${deleted} expired cart(s).`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
