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
