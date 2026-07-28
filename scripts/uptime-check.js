import { setTimeout as delay } from 'node:timers/promises';

/**
 * Uptime probe (Phase 3, Task 5).
 *
 * Checks the platform's own readiness endpoint **and** a real client
 * storefront, because they fail independently and only one of them is what a
 * shopper sees: the API can be perfectly ready while the storefront process is
 * dead, and vice versa. A monitor that only watches `/ready` reports green
 * through a total customer-facing outage.
 *
 *   node scripts/uptime-check.js https://admin.example.com/ready https://client.example.com/
 *
 * URLs are probed exactly as given. There is no clever default: the API's
 * meaningful check is `/ready`, a storefront's is `/`, and guessing which one
 * a URL wants produced a probe that asked a Next.js app for an endpoint it
 * has never had and called the store down.
 *
 * Exits 0 when everything answered, 1 otherwise — which is the whole
 * interface a scheduler, an external monitor, or a `||` in a shell script
 * needs. Meant to run every minute from Task Scheduler / cron, and to be
 * pointed at by an external service (see docs/runbooks/incident.md for why an
 * uptime check that runs on the box it monitors is not enough on its own).
 */

const TIMEOUT_MS = Number(process.env.UPTIME_TIMEOUT_MS ?? 10000);
const RETRIES = Number(process.env.UPTIME_RETRIES ?? 1);

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('Usage: node scripts/uptime-check.js <url> [url ...]');
  console.error('  Probe the API at /ready and each storefront at /.');
  process.exit(1);
}

async function probeOnce(url) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'storeforge-uptime-check' },
    });
    // 3xx is a pass: a secondary domain 301ing to the primary is the system
    // working exactly as designed, not an outage.
    const ok = res.status < 400;
    return { ok, status: res.status, ms: Date.now() - startedAt };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - startedAt, error: err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

async function probe(target) {
  const url = new URL(target);

  // One retry before crying wolf: a single dropped connection during a reload
  // is not an outage, and a monitor that pages on it gets muted.
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    const result = await probeOnce(url);
    if (result.ok || attempt === RETRIES) return { url, ...result, attempts: attempt + 1 };
    await delay(2000);
  }
  return null;
}

const results = await Promise.all(targets.map(probe));
let failed = 0;

for (const result of results) {
  const state = result.ok ? ' ok ' : 'DOWN';
  const detail = result.ok
    ? `${result.status} in ${result.ms}ms`
    : `${result.error ?? `status ${result.status}`} after ${result.attempts} attempt(s)`;
  console.log(`${state}  ${result.url.href.padEnd(48)} ${detail}`);
  if (!result.ok) failed += 1;
}

process.exitCode = failed > 0 ? 1 : 0;
