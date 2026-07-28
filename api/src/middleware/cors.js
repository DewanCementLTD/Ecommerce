import cors from 'cors';
import { withPlatform } from '../db/pool.js';
import { getRedis } from '../lib/redis.js';
import { platformKey, TTL } from '../lib/cache.js';
import { env } from '../config/env.js';

/**
 * CORS allowlist built from the database, not from a static list.
 *
 * `app.use(cors())` — what this replaced — answers every origin with
 * `Access-Control-Allow-Origin: *`. For an API whose whole job is to keep one
 * client's data away from another's, that is the wrong default: any page on
 * the internet could read any endpoint that does not require a bearer token
 * (the entire `/shop/*` and `/storefront/*` surface) directly from a visitor's
 * browser.
 *
 * An origin is allowed when its host is a domain we serve — the same `domains`
 * table the tenant resolver reads — plus the admin panels' own origins from
 * `ADMIN_ORIGINS`. Adding a client's domain therefore stays a data operation,
 * with no code change and no deploy, which is the rule the whole platform is
 * built on.
 *
 * Requests with no `Origin` header (server-to-server, curl, the storefront's
 * own SSR fetches) are allowed: CORS is a browser mechanism and there is
 * nothing to protect when no browser is involved.
 */

const ALLOWED_HOSTS_KEY = platformKey('cors', 'hosts');

/** Same normalization the tenant resolver uses. */
function hostOf(origin) {
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return null;
  }
}

async function allowedHosts() {
  const redis = getRedis();

  try {
    const cached = await redis.get(ALLOWED_HOSTS_KEY);
    if (cached) return new Set(JSON.parse(cached));
  } catch {
    // Redis down: fall through to the database rather than refusing everyone.
  }

  const rows = await withPlatform((conn) =>
    conn.execute('SELECT host FROM domains').then((res) => res.rows),
  );
  const hosts = rows.map((row) => String(row.HOST).toLowerCase());

  try {
    await redis.set(ALLOWED_HOSTS_KEY, JSON.stringify(hosts), 'EX', TTL.host);
  } catch {
    // Cache write failure is not a request failure.
  }

  return new Set(hosts);
}

export function corsMiddleware() {
  const adminOrigins = new Set(
    (env.adminOrigins ?? []).map((origin) => origin.trim().toLowerCase()).filter(Boolean),
  );

  return cors({
    credentials: true,
    origin: async (origin, callback) => {
      if (!origin) return callback(null, true);

      if (adminOrigins.has(origin.toLowerCase())) return callback(null, true);

      const host = hostOf(origin);
      if (!host) return callback(null, false);

      try {
        const hosts = await allowedHosts();
        // `localhost` covers the dev panels on their Vite ports without
        // needing every one of them listed; it is not a domain anyone can
        // point at this server from outside it.
        return callback(null, hosts.has(host) || host === 'localhost' || host === '127.0.0.1');
      } catch {
        // A database failure must not turn into a permissive answer.
        return callback(null, false);
      }
    },
  });
}
