import { getRedis } from '../lib/redis.js';
import { platformKey } from '../lib/cache.js';

/**
 * Request metrics, for the Super Admin dashboard's "error rate" and "slowest
 * endpoints" (Phase 3, Task 4).
 *
 * Kept in Redis rather than in process memory for one reason: production runs
 * the API under PM2 in cluster mode, so in-memory counters would each describe
 * one worker and the dashboard would report whichever worker happened to
 * answer. Redis is already a hard dependency and these are three commands per
 * request against hashes with a one-hour TTL.
 *
 * **Bucketed by route template, never by URL.** `/products/17` and
 * `/products/998` are the same endpoint; keying by URL would produce an
 * unbounded hash and a "slowest endpoints" list of one-hit wonders. Express
 * exposes the matched template on `req.route`, so the id is never in the key.
 *
 * Deliberately not per company: this measures the platform's health, and a
 * per-company breakdown of latency is a different (and much larger) feature.
 */

const WINDOW_SECONDS = 60 * 60;

const TOTALS_KEY = platformKey('metrics', 'totals');
const COUNT_KEY = platformKey('metrics', 'route', 'count');
const MS_KEY = platformKey('metrics', 'route', 'ms');
const MAX_KEY = platformKey('metrics', 'route', 'max');

/** `GET /products/:id` — the template, with the mount path it was reached on. */
function routeLabel(req) {
  const template = req.route?.path;
  if (!template) return `${req.method} (unmatched)`;
  const base = req.baseUrl || '';
  const path = template === '/' ? base || '/' : `${base}${template}`;
  return `${req.method} ${path}`;
}

export function metrics(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const label = routeLabel(req);

    // The health endpoints are polled by the process manager every few
    // seconds; counting them would drown out real traffic in every average.
    if (req.path === '/health' || req.path === '/ready') return;

    const bucket =
      res.statusCode >= 500 ? 'server_errors' : res.statusCode >= 400 ? 'client_errors' : 'ok';

    getRedis()
      .multi()
      .hincrby(TOTALS_KEY, 'requests', 1)
      .hincrby(TOTALS_KEY, bucket, 1)
      .expire(TOTALS_KEY, WINDOW_SECONDS)
      .hincrby(COUNT_KEY, label, 1)
      .hincrbyfloat(MS_KEY, label, ms)
      .expire(COUNT_KEY, WINDOW_SECONDS)
      .expire(MS_KEY, WINDOW_SECONDS)
      .exec()
      .catch(() => {
        // Metrics are observability, not correctness. A Redis blip must never
        // surface on a request that already succeeded.
      });

    // Slowest-single-call per route, tracked separately because an average
    // hides the one request that took nine seconds.
    getRedis()
      .hget(MAX_KEY, label)
      .then((current) => {
        if (current === null || ms > Number(current)) {
          return getRedis().multi().hset(MAX_KEY, label, ms.toFixed(1)).expire(MAX_KEY, WINDOW_SECONDS).exec();
        }
        return null;
      })
      .catch(() => {});
  });

  next();
}

/**
 * What the dashboard reads. Returns null values rather than throwing when
 * Redis is unavailable — a monitoring page that 500s when the thing it
 * monitors is unwell is the least useful page in the system.
 */
export async function readMetrics({ slowestLimit = 8 } = {}) {
  try {
    const redis = getRedis();
    const [totals, counts, totalMs, maxMs] = await Promise.all([
      redis.hgetall(TOTALS_KEY),
      redis.hgetall(COUNT_KEY),
      redis.hgetall(MS_KEY),
      redis.hgetall(MAX_KEY),
    ]);

    const requests = Number(totals.requests ?? 0);
    const serverErrors = Number(totals.server_errors ?? 0);
    const clientErrors = Number(totals.client_errors ?? 0);

    const slowest = Object.entries(counts)
      .map(([route, count]) => ({
        route,
        count: Number(count),
        avgMs: Number(totalMs[route] ?? 0) / Math.max(Number(count), 1),
        maxMs: Number(maxMs[route] ?? 0),
      }))
      .sort((a, b) => b.avgMs - a.avgMs)
      .slice(0, slowestLimit);

    return {
      windowSeconds: WINDOW_SECONDS,
      requests,
      serverErrors,
      clientErrors,
      errorRate: requests > 0 ? serverErrors / requests : 0,
      slowest,
      available: true,
    };
  } catch {
    return { available: false, windowSeconds: WINDOW_SECONDS, requests: 0, slowest: [] };
  }
}
