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
