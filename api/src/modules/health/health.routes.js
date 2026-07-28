import { Router } from 'express';
import { withPlatform } from '../../db/pool.js';
import { getRedis } from '../../lib/redis.js';

/**
 * Liveness and readiness, kept apart on purpose (Phase 3, Task 5).
 *
 * **`/health` — liveness.** "Is this process alive and able to answer?" It
 * touches nothing external and must never fail for a reason outside the
 * process, because a process manager restarts what fails here. If `/health`
 * checked Oracle, a five-second database blip would restart every API worker
 * on the box, turning a brief outage into a long one.
 *
 * **`/ready` — readiness.** "Should this process be sent traffic right now?"
 * Oracle and Redis are both checked, because without either the API can only
 * return errors. A load balancer takes an unready worker out of rotation and
 * puts it back when it recovers; nothing gets killed.
 *
 * Both are unauthenticated: they expose no data, and a monitor that needs a
 * credential is a monitor that stops working when the credential rotates.
 * Neither is counted in the request metrics (see middleware/metrics.js) —
 * polled every few seconds, they would otherwise dominate every average.
 */
export const healthRouter = Router();

const CHECK_TIMEOUT_MS = 2000;

/** A check that hangs is a check that failed — readiness has to answer fast. */
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} check timed out`)), CHECK_TIMEOUT_MS),
    ),
  ]);
}

healthRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: Math.round(process.uptime()) });
});

healthRouter.get('/ready', async (req, res) => {
  const checks = {};

  const [database, redis] = await Promise.allSettled([
    withTimeout(
      withPlatform((conn) => conn.execute('SELECT 1 AS ok FROM dual')),
      'database',
    ),
    withTimeout(getRedis().ping(), 'redis'),
  ]);

  checks.database = database.status === 'fulfilled' ? 'ok' : (database.reason?.message ?? 'failed');
  checks.redis = redis.status === 'fulfilled' ? 'ok' : (redis.reason?.message ?? 'failed');

  const ready = checks.database === 'ok' && checks.redis === 'ok';

  // 503, not 500: this is "not ready", a state the caller is expected to
  // retry, not an error in handling the request.
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready', checks });
});
