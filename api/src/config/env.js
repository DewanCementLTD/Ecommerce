import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../../../');
config({ path: path.join(rootDir, '.env') });

/**
 * @type {{
 *   port: number, nodeEnv: string, logLevel: string,
 *   db: { user: string, password: string, dsn: string, poolMin: number, poolMax: number,
 *         platformUser: string, platformPassword: string },
 * }}
 */
export const env = {
  port: Number(process.env.PORT ?? 8003),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  mail: {
    // 'log' (default, no setup needed — this dev box has no SMTP catcher) or 'smtp'.
    provider: process.env.EMAIL_PROVIDER ?? 'log',
    smtp: {
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM ?? 'no-reply@example.com',
    },
  },
  /**
   * Error tracking. With no DSN the API reports errors to its own log and
   * loads no agent at all — see lib/errorTracker.js.
   */
  sentry: {
    dsn: process.env.SENTRY_DSN || null,
    release: process.env.SENTRY_RELEASE || null,
  },

  /**
   * Origins allowed through CORS on top of the stores' own domains: the admin
   * and Super Admin panels, which are served from somewhere that is not a
   * client domain. Comma-separated.
   */
  adminOrigins: (process.env.ADMIN_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  /**
   * Where the Next.js storefront answers, so the API can ask it to drop its
   * fetch cache for a store after a write. Both values unset (the default)
   * turns tag-based revalidation off entirely and leaves the storefront on its
   * own 60-second windows — see lib/revalidate.js.
   */
  storefront: {
    url: process.env.STOREFRONT_URL || null,
    revalidateSecret: process.env.REVALIDATE_SECRET || null,
  },
  db: {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    dsn: process.env.DB_DSN,
    poolMin: Number(process.env.DB_POOL_MIN ?? 2),
    poolMax: Number(process.env.DB_POOL_MAX ?? 10),
    platformUser: process.env.DB_PLATFORM_USER,
    platformPassword: process.env.DB_PLATFORM_PASSWORD,
  },
};
