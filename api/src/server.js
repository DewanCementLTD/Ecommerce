import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { initPool, closePool } from './db/pool.js';
import { closeRedis } from './lib/redis.js';

await initPool();

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, 'api listening');
});

async function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await closePool();
  await closeRedis();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
