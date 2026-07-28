import { verifyAccessToken } from '../lib/jwt.js';
import { getRedis } from '../lib/redis.js';
import { platformKey } from '../lib/cache.js';
import { AppError } from './error.js';

/**
 * Sibling of requireAuth (admins) for the storefront's customer accounts —
 * same JWT contract, a distinct claim (role: 'customer') and Redis blacklist
 * namespace (sf:custauth:*) so a revoked admin session can never be confused
 * with a revoked customer one. Mounted after tenantResolver, so req.companyId
 * is already the host-resolved company; the token's own company_id must match
 * it, or a customer token from company A could otherwise be replayed on B's
 * storefront if the two ever shared a JWT secret misconfiguration.
 */
export async function requireCustomerAuth(req, res, next) {
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

    if (decoded.role !== 'customer' || decoded.company_id !== req.companyId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid or expired token.');
    }

    const blacklisted = await getRedis().get(platformKey('custauth', 'blacklist', decoded.jti));
    if (blacklisted) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Token has been revoked.');
    }

    req.customer = { id: decoded.sub, companyId: decoded.company_id, jti: decoded.jti, exp: decoded.exp };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * The cart is public — a guest must be able to use it with no token at all —
 * but a logged-in customer's cart should still attach to their account. This
 * attaches req.customer when a valid customer bearer token is present and
 * silently does nothing otherwise, rather than rejecting the request.
 */
export async function optionalCustomerAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();

  try {
    const decoded = verifyAccessToken(header.slice('Bearer '.length));
    if (decoded.role !== 'customer' || decoded.company_id !== req.companyId) return next();
    if (await getRedis().get(platformKey('custauth', 'blacklist', decoded.jti))) return next();
    req.customer = { id: decoded.sub, companyId: decoded.company_id, jti: decoded.jti, exp: decoded.exp };
  } catch {
    // Not a valid customer token — treat the request as a guest.
  }
  next();
}
