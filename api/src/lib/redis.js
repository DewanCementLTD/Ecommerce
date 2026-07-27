import Redis from 'ioredis';
import { env } from '../config/env.js';

let client;

export function getRedis() {
  if (!client) {
    client = new Redis({
      host: env.redis.host,
      port: env.redis.port,
      password: env.redis.password,
      lazyConnect: false,
    });
  }
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit();
    client = undefined;
  }
}
