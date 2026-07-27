import oracledb from 'oracledb';
import argon2 from 'argon2';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

async function run() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const password = process.env.PLATFORM_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD must be set in .env');
  }

  // Uses the VPD-exempt platform user: an admins row with company_id IS NULL
  // fails the standard policy's update_check under the ecomm user, since
  // "NULL = NULL" is never true in SQL — this is exactly the access pattern
  // withPlatform() exists for.
  const conn = await oracledb.getConnection({
    user: process.env.DB_PLATFORM_USER,
    password: process.env.DB_PLATFORM_PASSWORD,
    connectString: process.env.DB_DSN,
  });

  try {
    const existing = await conn.execute('SELECT id FROM admins WHERE email = :email', { email });
    if (existing.rows.length > 0) {
      console.log(`Platform admin ${email} already exists, skipping.`);
      return;
    }

    const passHash = await argon2.hash(password);
    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (NULL, :email, :passHash, 'Super Admin', 'platform', 1)`,
      { email, passHash },
    );
    await conn.commit();
    console.log(`Created platform admin ${email}.`);
  } finally {
    await conn.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
