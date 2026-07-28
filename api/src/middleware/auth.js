import { verifyAccessToken } from '../lib/jwt.js';
import { getRedis } from '../lib/redis.js';
import { platformKey } from '../lib/cache.js';
import { isSessionRevoked } from '../lib/sessions.js';
import { AppError } from './error.js';

/**
 * Verifies the bearer access token and attaches req.admin from its claims
 * ONLY — never from the URL or request body. Downstream company-scoped
 * routes must use req.admin.companyId, never a client-supplied company id.
 */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Missing bearer token.');
    }
    const token = header.slice('Bearer '.length);

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch {
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token.');
    }

    const blacklisted = await getRedis().get(platformKey('auth', 'blacklist', decoded.jti));
    if (blacklisted) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Token has been revoked.');
    }

    // Blacklisting covers one logged-out token; the epoch covers "every token
    // this account has" — what a password reset or a deactivation needs.
    if (await isSessionRevoked(decoded.sub, decoded.iat)) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Token has been revoked.');
    }

    req.admin = {
      id: decoded.sub,
      companyId: decoded.company_id,
      role: decoded.role,
      jti: decoded.jti,
      exp: decoded.exp,
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(new AppError(403, 'FORBIDDEN', 'Insufficient role.'));
    }
    next();
  };
}
