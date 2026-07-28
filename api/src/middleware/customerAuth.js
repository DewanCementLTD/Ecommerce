import { verifyAccessToken } from '../lib/jwt.js';
import { getRedis } from '../lib/redis.js';
import { AppError } from './error.js';

/**
 * Sibling of requireAuth (admins) for the storefront's customer accounts —
 * same JWT contract, a distinct claim (role: 'customer') and Redis blacklist
 * namespace (custauth:*) so a revoked admin session can never be confused
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

    const blacklisted = await getRedis().get(`custauth:blacklist:${decoded.jti}`);
    if (blacklisted) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Token has been revoked.');
    }

    req.customer = { id: decoded.sub, companyId: decoded.company_id, jti: decoded.jti, exp: decoded.exp };
    next();
  } catch (err) {
    next(err);
  }
}
