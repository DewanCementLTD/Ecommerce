import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import oracledb from 'oracledb';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { initPool, closePool, withPlatform } from '../../src/db/pool.js';
import { closeRedis, getRedis } from '../../src/lib/redis.js';
import { companyKey, platformKey, cached, invalidate, TTL } from '../../src/lib/cache.js';

/**
 * The cache-key prefix rule from `00-SYSTEM-DESIGN.md §7`, enforced.
 *
 * "Cache keys are always prefixed with the company: `co:{id}:settings`. A
 * missing prefix is a cross-tenant bug." That is only true if something checks
 * it, so this suite records **every** Redis key the API touches while serving a
 * realistic mix of traffic and asserts each one is either company-scoped
 * (`co:{id}:...`) or explicitly platform-scoped (`sf:...`).
 *
 * The recorder wraps `sendCommand`, which every ioredis call funnels through —
 * including the ones inside a pipeline — so a service that reaches past
 * `lib/cache.js` and builds a raw key by hand still gets caught.
 */

const suffix = Date.now();
const password = 'correct horse battery staple';
const email = `cache-owner-${suffix}@example.test`;
const host = `cache-${suffix}.localhost`;
const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

/** Commands whose first argument is a key. Everything else is bookkeeping. */
const KEY_COMMANDS = new Set([
  'get', 'set', 'setex', 'getex', 'del', 'unlink', 'exists', 'incr', 'decr',
  'expire', 'ttl', 'sadd', 'srem', 'smembers', 'sismember', 'hget', 'hset',
]);

const COMPANY_SCOPED = /^co:\d+:.+/;
const PLATFORM_SCOPED = /^sf:.+/;

let app;
let token;
let companyId;
let recorded;
let restoreSendCommand;

function startRecording() {
  const redis = getRedis();
  recorded = [];
  const original = redis.sendCommand.bind(redis);
  redis.sendCommand = (command, ...rest) => {
    if (KEY_COMMANDS.has(String(command?.name).toLowerCase())) {
      const key = command.args?.[0];
      if (typeof key === 'string') recorded.push(`${command.name} ${key}`);
    }
    return original(command, ...rest);
  };
  restoreSendCommand = () => {
    redis.sendCommand = original;
  };
}

beforeAll(async () => {
  await initPool();
  const passHash = await argon2.hash(password);

  await withPlatform(async (conn) => {
    companyId = (
      await conn.execute(
        `INSERT INTO companies (name, status, currency) VALUES (:name, 'active', 'BDT')
         RETURNING id INTO :id`,
        { name: `Cache Co ${suffix}`, id: OUT_ID },
      )
    ).outBinds.id[0];

    await conn.execute('INSERT INTO domains (company_id, host, is_primary) VALUES (:companyId, :host, 1)', {
      companyId,
      host,
    });

    await conn.execute(
      `INSERT INTO admins (company_id, email, pass_hash, name, role, is_active)
       VALUES (:companyId, :email, :passHash, 'Cache Owner', 'owner', 1)`,
      { companyId, email, passHash },
    );

    await conn.commit();
  });

  app = createApp();
  token = (await request(app).post('/auth/login').send({ email, password })).body.accessToken;
});

afterAll(async () => {
  restoreSendCommand?.();
  const redis = getRedis();
  await redis.del(platformKey('host', host));
  await redis.del(companyKey(companyId, 'idx'));

  await withPlatform(async (conn) => {
    for (const sql of [
      'DELETE FROM settings WHERE company_id = :companyId',
      'DELETE FROM logs WHERE company_id = :companyId',
      'DELETE FROM admins WHERE company_id = :companyId',
      'DELETE FROM domains WHERE company_id = :companyId',
      'DELETE FROM companies WHERE id = :companyId',
    ]) {
      await conn.execute(sql, { companyId });
    }
    await conn.commit();
  });

  await closeRedis();
  await closePool();
});

describe('cache key naming', () => {
  it('builds company keys as co:{id}:{name}', () => {
    expect(companyKey(7, 'settings')).toBe('co:7:settings');
    expect(companyKey(7, 'menus', 'ar')).toBe('co:7:menus:ar');
  });

  it('refuses to build a key without a real company id', () => {
    // The whole point of the prefix is that it carries the tenant. A key built
    // from undefined would read `co:undefined:settings` and be shared by every
    // store that hit the same bug.
    expect(() => companyKey(undefined, 'settings')).toThrow();
    expect(() => companyKey(null, 'settings')).toThrow();
    expect(() => companyKey(0, 'settings')).toThrow();
    expect(() => companyKey('not-a-number', 'settings')).toThrow();
    expect(() => companyKey(7)).toThrow();
    expect(() => companyKey(7, '')).toThrow();
  });

  it('keeps platform keys in their own namespace, never a bare name', () => {
    expect(platformKey('host', 'example.test')).toBe('sf:host:example.test');
  });
});

describe('the prefix rule holds for every key the API actually touches', () => {
  it('records only co:{id}: and sf: keys across a realistic mix of traffic', async () => {
    startRecording();

    const shop = (path) => request(app).get(path).set('X-Forwarded-Host', host);
    const auth = (req) => req.set('Authorization', `Bearer ${token}`);

    // Storefront reads (host resolution, company, settings, menus, sections),
    // an admin write (settings save → invalidation), an admin read, and a
    // failed login (the lockout counter).
    await shop('/storefront/company');
    await shop('/shop/products');
    await shop('/shop/menus');
    await shop('/shop/home');
    await shop('/shop/sitemap');
    await auth(request(app).put('/settings')).send({ values: { seo_title: `Cache ${suffix}` } });
    await auth(request(app).get('/settings'));
    await request(app).post('/auth/login').send({ email, password: 'wrong password' });
    await shop('/storefront/company');

    restoreSendCommand();

    expect(recorded.length).toBeGreaterThan(5);

    const offenders = recorded.filter((entry) => {
      const key = entry.split(' ').slice(1).join(' ');
      return !COMPANY_SCOPED.test(key) && !PLATFORM_SCOPED.test(key);
    });

    expect(offenders, `unprefixed cache keys: ${offenders.join(', ')}`).toEqual([]);
  });

  it('never writes a key containing "undefined" or "null" where the id should be', async () => {
    const suspicious = recorded.filter((entry) => /co:(undefined|null|NaN):/.test(entry));
    expect(suspicious).toEqual([]);
  });

  it('the recorder itself catches an unprefixed key (so a green run means something)', async () => {
    // A guard that cannot fail is not a guard. This writes the exact mistake
    // the suite exists to catch — a raw key built by hand, bypassing
    // lib/cache.js — and proves the recorder sees it.
    startRecording();
    await getRedis().set(`settings-${suffix}`, '1', 'EX', 5);
    restoreSendCommand();

    const offenders = recorded.filter((entry) => {
      const key = entry.split(' ').slice(1).join(' ');
      return !COMPANY_SCOPED.test(key) && !PLATFORM_SCOPED.test(key);
    });

    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toContain(`settings-${suffix}`);
    await getRedis().del(`settings-${suffix}`);
  });
});

describe('read-through caching and invalidation', () => {
  it('serves the second read from Redis without calling the loader again', async () => {
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return { value: loads };
    };

    await invalidate(companyId, 'probe');
    expect(await cached(companyId, 'probe', TTL.settings, loader)).toEqual({ value: 1 });
    expect(await cached(companyId, 'probe', TTL.settings, loader)).toEqual({ value: 1 });
    expect(loads).toBe(1);

    await invalidate(companyId, 'probe');
    expect(await cached(companyId, 'probe', TTL.settings, loader)).toEqual({ value: 2 });
    expect(loads).toBe(2);
  });

  it('invalidates by prefix, so one call clears every language of a menu', async () => {
    await cached(companyId, 'menus:en', TTL.menus, async () => ({ lang: 'en' }));
    await cached(companyId, 'menus:ar', TTL.menus, async () => ({ lang: 'ar' }));

    const redis = getRedis();
    expect(await redis.get(companyKey(companyId, 'menus:en'))).not.toBeNull();
    expect(await redis.get(companyKey(companyId, 'menus:ar'))).not.toBeNull();

    await invalidate(companyId, 'menus');

    expect(await redis.get(companyKey(companyId, 'menus:en'))).toBeNull();
    expect(await redis.get(companyKey(companyId, 'menus:ar'))).toBeNull();
  });

  it('a settings save is visible on the very next storefront read', async () => {
    const shop = () => request(app).get('/storefront/company').set('X-Forwarded-Host', host);
    const auth = (req) => req.set('Authorization', `Bearer ${token}`);

    await shop(); // warm the cache
    await auth(request(app).put('/settings')).send({ values: { seo_title: `Renamed ${suffix}` } });

    const res = await shop();
    expect(res.body.company.seoTitle).toBe(`Renamed ${suffix}`);
  });
});
