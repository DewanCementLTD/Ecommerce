import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logs: stdout in development, rotated files *and* stdout in
 * production.
 *
 * `pino-roll` writes into `logs/`, rolling daily and at 20MB, keeping the last
 * 14 files. Rotation is the transport's job rather than the process manager's
 * because this has to behave identically whether the API was started by PM2,
 * by a Windows service, or by hand during an incident — which is the one time
 * nobody wants to discover the logs were going nowhere.
 *
 * Both destinations in production: the file is the durable record, stdout is
 * what `pm2 logs` shows. Losing one does not lose the other.
 *
 * **Redaction is not optional.** `LOG_LEVEL=debug` makes pino-http log every
 * request's headers, and everything here authenticates with bearer tokens or
 * a cart token — a debug session would otherwise write live credentials to
 * disk. These paths are stripped whether or not anyone remembers to lower the
 * level first. (`docs/SECURITY-REVIEW.md` §12 raised exactly this.)
 */

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../../../');
export const logDir = process.env.LOG_DIR ?? path.join(rootDir, 'logs');

const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-cart-token"]',
  'req.headers["x-revalidate-secret"]',
  'res.headers["set-cookie"]',
  'password',
  '*.password',
  'passHash',
  '*.passHash',
  'tempPassword',
  '*.tempPassword',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
];

function transport() {
  if (env.nodeEnv !== 'production') return undefined;

  return {
    targets: [
      {
        target: 'pino-roll',
        level: env.logLevel,
        options: {
          file: path.join(logDir, 'api'),
          extension: '.log',
          frequency: 'daily',
          size: '20m',
          limit: { count: 14 },
          mkdir: true,
          dateFormat: 'yyyy-MM-dd',
        },
      },
      { target: 'pino/file', level: env.logLevel, options: { destination: 1 } },
    ],
  };
}

export const logger = pino({
  level: env.logLevel,
  redact: { paths: REDACT, remove: true },
  base: { service: 'storeforge-api' },
  transport: transport(),
});
