import tls from 'node:tls';
import { getRedis } from './redis.js';
import { platformKey } from './cache.js';

/**
 * "Is this client's domain actually serving valid HTTPS?"
 *
 * The Super Admin health card claims to show domain/SSL status, and the only
 * honest way to know is to connect. This opens a TLS session to the host,
 * reads the peer certificate, and reports the issuer and expiry — or the
 * reason it could not.
 *
 * Three properties matter here:
 *
 * - **A short timeout.** A dashboard that hangs because one client let their
 *   DNS lapse is worse than one that says "timed out" in three seconds.
 * - **Cached.** An hour per host: certificates do not change minute to
 *   minute, and a page that opens a TLS handshake per row on every refresh is
 *   its own denial of service.
 * - **Never throws.** Every failure is a *result* — an unreachable domain is
 *   information the operator wants, not an error page.
 */

const TIMEOUT_MS = 3000;
const CACHE_TTL_SECONDS = 60 * 60;

function inspect(host) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    const socket = tls.connect(
      {
        host,
        port: 443,
        servername: host,
        // `rejectUnauthorized: false` so an *invalid* certificate is still
        // inspected and reported rather than becoming a bare connection
        // error. Validity is then judged explicitly below — this is a
        // diagnostic tool, not a client trusting the endpoint with data.
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS,
      },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          return done({ ok: false, reason: 'no certificate presented' });
        }

        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const daysRemaining = validTo
          ? Math.floor((validTo.getTime() - Date.now()) / 86400000)
          : null;

        done({
          ok: socket.authorized,
          reason: socket.authorized ? null : (socket.authorizationError ?? 'not trusted'),
          issuer: cert.issuer?.O ?? cert.issuer?.CN ?? null,
          subject: cert.subject?.CN ?? null,
          validTo: validTo ? validTo.toISOString() : null,
          daysRemaining,
        });
      },
    );

    socket.on('timeout', () => done({ ok: false, reason: 'timed out' }));
    socket.on('error', (err) => done({ ok: false, reason: err.code ?? err.message }));
  });
}

export async function checkSsl(host) {
  const key = platformKey('ssl', String(host).toLowerCase());
  const redis = getRedis();

  try {
    const cached = await redis.get(key);
    if (cached) return JSON.parse(cached);
  } catch {
    // Cache miss by way of outage: just check.
  }

  const result = { host, checkedAt: new Date().toISOString(), ...(await inspect(host)) };

  try {
    await redis.set(key, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // Not being able to cache the answer does not make it a worse answer.
  }

  return result;
}
