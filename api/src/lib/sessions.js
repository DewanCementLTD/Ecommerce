import { getRedis } from './redis.js';
import { platformKey } from './cache.js';
import { parseDurationToSeconds } from './duration.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Bulk session revocation, by token epoch.
 *
 * Logout blacklists one `jti`, which is the right shape for "this browser is
 * done". It is the wrong shape for "this account's password just changed" or
 * "this person has left the company": those have to invalidate every session
 * that exists, and we do not keep a list of an account's live `jti`s to walk.
 *
 * Instead each admin gets an epoch — a timestamp — and any token issued before
 * it is refused. Setting the epoch is one `SET`; checking it is one `GET` on a
 * request that is already reading Redis for the blacklist. Revocation is
 * immediate rather than "within fifteen minutes when the access token
 * expires", which for a compromised or departed account is the whole point.
 *
 * The key expires after the refresh-token lifetime: once no token issued
 * before the epoch could still be valid, the epoch has nothing left to say.
 */
const EPOCH_TTL_SECONDS = parseDurationToSeconds(env.jwt.refreshTtl);

function epochKey(adminId) {
  return platformKey('auth', 'epoch', String(adminId));
}

/**
 * Invalidates every access and refresh token issued to this admin so far.
 * Call it on password change and on deactivation.
 */
export async function revokeAdminSessions(adminId) {
  if (!adminId) return;
  try {
    // Seconds, to match the `iat` claim's unit. Rounded up so a token minted
    // in the same second as the revocation is also refused — the safe
    // direction to be wrong in.
    const now = Math.ceil(Date.now() / 1000);
    await getRedis().set(epochKey(adminId), String(now), 'EX', EPOCH_TTL_SECONDS);
  } catch (err) {
    logger.error({ err, adminId }, 'failed to revoke sessions; tokens remain valid until they expire');
    throw err;
  }
}

/** True when this token predates the account's last revocation. */
export async function isSessionRevoked(adminId, issuedAt) {
  if (!adminId || !issuedAt) return false;
  try {
    const epoch = await getRedis().get(epochKey(adminId));
    return epoch !== null && Number(issuedAt) < Number(epoch);
  } catch (err) {
    // Redis unreachable. Refusing every request would turn a cache outage into
    // a full outage; the blacklist check above this one has the same posture.
    logger.warn({ err, adminId }, 'could not check session revocation');
    return false;
  }
}
