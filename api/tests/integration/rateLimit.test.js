import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { rateLimit } from '../../src/middleware/rateLimit.js';
import { errorHandler } from '../../src/middleware/error.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { platformKey } from '../../src/lib/cache.js';

/**
 * The rate limiter itself, driven directly.
 *
 * The limiters mounted on real routes are disabled under `NODE_ENV=test`
 * (see the note in rateLimit.js — every one of them is keyed by IP and the
 * whole suite shares 127.0.0.1), so this suite opts back in with the header
 * that middleware honours. That way the protection is proven without every
 * other test having to budget for it.
 */

const suffix = Date.now();
const key = platformKey('test', 'ratelimit', String(suffix));

let app;

beforeAll(() => {
  app = express();
  app.get(
    '/limited',
    rateLimit({ keyFn: () => key, limit: 3, windowSeconds: 60 }),
    (req, res) => res.json({ ok: true }),
  );
  app.use(errorHandler);
});

afterAll(async () => {
  await getRedis().del(key);
  await closeRedis();
});

const hit = () => request(app).get('/limited').set('X-Force-Rate-Limit', '1');

describe('rateLimit middleware', () => {
  it('allows requests up to the limit and refuses the next one', async () => {
    for (let i = 1; i <= 3; i += 1) {
      const res = await hit();
      expect(res.status, `request ${i}`).toBe(200);
    }

    const blocked = await hit();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('TOO_MANY_REQUESTS');
    // The message has to tell the caller when to come back, or a legitimate
    // user who trips it has no idea whether to wait a second or an hour.
    expect(blocked.body.error.message).toMatch(/\d+ seconds/);
  });

  it('keeps refusing while the window is open, without extending it', async () => {
    const first = await hit();
    expect(first.status).toBe(429);

    const ttl = await getRedis().ttl(key);
    const second = await hit();
    expect(second.status).toBe(429);

    // A limiter that re-EXPIREs on every blocked hit locks the caller out for
    // ever under sustained traffic. The window must run down on its own.
    const ttlAfter = await getRedis().ttl(key);
    expect(ttlAfter).toBeLessThanOrEqual(ttl);
  });

  it('is off by default under NODE_ENV=test, so route suites are not rate limited', async () => {
    // Same app, same key, no opt-in header: this would be the 6th+ request in
    // a window of 3 if the limiter were active.
    const res = await request(app).get('/limited');
    expect(res.status).toBe(200);
  });
});
