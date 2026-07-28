import { Router } from 'express';
import { postLogin, postRefresh, postLogout, getMe } from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { platformKey } from '../../lib/cache.js';

/**
 * Per-IP limit on top of the per-account lockout in auth.service.js. The
 * lockout stops someone grinding one account; this stops someone spraying one
 * password across many accounts from one place, which the lockout cannot see.
 * Platform-namespaced: an admin login is not scoped to a company.
 */
const loginRateLimit = rateLimit({
  keyFn: (req) => platformKey('auth', 'attempt', req.ip),
  limit: 20,
  windowSeconds: 15 * 60,
});

export const authRouter = Router();

authRouter.post('/login', loginRateLimit, postLogin);
authRouter.post('/refresh', loginRateLimit, postRefresh);
authRouter.post('/logout', requireAuth, postLogout);
authRouter.get('/me', requireAuth, getMe);
