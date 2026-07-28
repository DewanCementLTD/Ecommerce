import oracledb from 'oracledb';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
loadEnv({ path: path.join(rootDir, '.env') });

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Every table granted to sf_platform_role in 001_init.sql needs a matching
// synonym here too — object grants alone don't let ecomm_platform resolve
// unqualified table names, since those resolve against its own (empty) schema.
const PLATFORM_TABLES = [
  'companies',
  'domains',
  'themes',
  'admins',
  'roles',
  'settings',
  'langs',
  'logs',
  'media',
  'cats',
  'products',
  'variants',
  'options',
  'prod_imgs',
  'prod_cats',
  'colls',
  'coll_prods',
  'pages',
  'sections',
  'banners',
  'menus',
  'menu_items',
  'trans',
  'customers',
  'addrs',
  'carts',
  'cart_items',
  'order_seq',
  'orders',
  'order_items',
  'order_log',
];

async function run() {
  const platformUser = process.env.DB_PLATFORM_USER;
  const platformPassword = process.env.DB_PLATFORM_PASSWORD;

  if (!platformUser || !platformPassword) {
    throw new Error('DB_PLATFORM_USER and DB_PLATFORM_PASSWORD must be set in .env');
  }
  if (!IDENTIFIER_RE.test(platformUser)) {
    throw new Error(`DB_PLATFORM_USER "${platformUser}" is not a safe SQL identifier`);
  }

  const conn = await oracledb.getConnection({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_DSN,
  });

  try {
    const existing = await conn.execute(
      'SELECT username FROM all_users WHERE username = :username',
      { username: platformUser.toUpperCase() },
    );

    if (existing.rows.length > 0) {
      console.log(`${platformUser} already exists, skipping creation.`);
    } else {
      await conn.execute(
        `BEGIN EXECUTE IMMEDIATE 'CREATE USER ' || :username || ' IDENTIFIED BY "' || :password || '"'; END;`,
        { username: platformUser, password: platformPassword },
      );
      console.log(`Created user ${platformUser}.`);
    }

    await conn.execute(`GRANT CREATE SESSION TO ${platformUser}`);
    await conn.execute(`GRANT EXEMPT ACCESS POLICY TO ${platformUser}`);
    await conn.execute(`GRANT sf_platform_role TO ${platformUser}`);
    console.log(`Granted CREATE SESSION, EXEMPT ACCESS POLICY, sf_platform_role to ${platformUser}.`);

    for (const table of PLATFORM_TABLES) {
      await conn.execute(`CREATE OR REPLACE SYNONYM ${platformUser}.${table} FOR ${table}`);
    }
    console.log(`Created/refreshed synonyms for: ${PLATFORM_TABLES.join(', ')}.`);
  } finally {
    await conn.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
