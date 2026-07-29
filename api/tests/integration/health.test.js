import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool } from '../../src/db/pool.js';
import { closeRedis } from '../../src/lib/redis.js';

/**
 * Liveness and readiness are separate endpoints and are tested separately,
 * because the whole point of the split is that they answer different questions
 * and fail for different reasons (see health.routes.js).
 */

describe('GET /health — liveness', () => {
  it('answers without touching Oracle or Redis', async () => {
    // No initPool() here on purpose. If /health needed the database this would
    // fail — and a liveness probe that depends on the database makes a brief
    // database blip restart every worker on the box.
    const res = await request(createApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
  });
});

describe('GET /ready — readiness', () => {
  afterAll(async () => {
    await closeRedis();
    await closePool();
  });

  it('reports each dependency by name when everything is up', async () => {
    await initPool();
    const res = await request(createApp()).get('/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
    // Naming the checks is the feature: "not ready" without saying which
    // dependency is down sends whoever is on call looking at all of them.
    expect(res.body.checks).toEqual({ database: 'ok', redis: 'ok' });
  });
});
