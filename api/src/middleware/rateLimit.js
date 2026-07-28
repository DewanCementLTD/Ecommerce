import { getRedis } from '../lib/redis.js';
import { AppError } from './error.js';

/**
 * The one rate-limiting technique this codebase uses (auth.service.js's
 * login lockout does the same INCR-then-EXPIRE-on-first-hit), generalized
 * into reusable middleware. No generic rate-limit middleware existed before
 * checkout needed one.
 */
export function rateLimit({ keyFn, limit, windowSeconds }) {
  return async (req, res, next) => {
    /*
     * Off under `NODE_ENV=test`.
     *
     * Every limiter here is keyed by IP, and the whole test suite comes from
     * 127.0.0.1: several hundred logins, searches and uploads inside a few
     * minutes. Leaving it on would mean tests failing with 429 for reasons
     * that have nothing to do with what they assert, and the usual "fix" for
     * that is to raise the production limits until the tests pass — which
     * quietly removes the protection instead of the noise.
     *
     * The mechanism itself is still covered: `rateLimit.test.js` drives this
     * middleware directly rather than through a route.
     */
    if (process.env.NODE_ENV === 'test' && !req.headers['x-force-rate-limit']) return next();

    try {
      const redis = getRedis();
      const key = keyFn(req);
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowSeconds);
      if (count > limit) {
        const ttl = await redis.ttl(key);
        throw new AppError(
          429,
          'TOO_MANY_REQUESTS',
          `Too many attempts. Try again in ${Math.max(ttl, 1)} seconds.`,
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
