import autocannon from 'autocannon';

/**
 * Load test for the three pages that carry a storefront: home, a category, and
 * a product. Phase 3, Task 2.
 *
 * Two rules make the numbers mean something:
 *
 * 1. **Against a production build.** `next dev` compiles on demand and ships
 *    an unminified bundle; measuring it tells you about the dev server, not
 *    the site. Run `npm run build --workspace=storefront` and `npm run start
 *    --workspace=storefront` first.
 * 2. **By Host header, not by hostname.** Every store is resolved from `Host`,
 *    and `*.localhost` does not resolve on Windows without a hosts entry, so
 *    requests go to 127.0.0.1 and carry the store's host explicitly. This is
 *    also exactly what Nginx does in production.
 *
 *   node scripts/loadtest.js [--host demo-a.localhost] [--port 3001]
 *                            [--connections 20] [--duration 15] [--api]
 *
 * `--api` points at the Express API (default :8003) instead of the storefront,
 * which is how you tell "the page is slow" apart from "the data is slow".
 */

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const host = arg('host', 'demo-a.localhost');
const api = process.argv.includes('--api');
const port = Number(arg('port', api ? 8003 : 3001));
const connections = Number(arg('connections', 20));
const duration = Number(arg('duration', 15));

/**
 * The API is asked for the same three things the pages are built from. The
 * storefront paths are the pages themselves; the API paths are what those
 * pages fetch.
 */
const TARGETS = api
  ? [
      { label: 'home sections', path: '/shop/home' },
      { label: 'category listing', path: '/shop/products?pageSize=24' },
      { label: 'company + settings', path: '/storefront/company' },
    ]
  : [
      { label: 'home', path: '/' },
      { label: 'category', path: null },
      { label: 'product', path: null },
    ];

/** Ask the API which category and product this store actually has. */
async function resolveStorefrontPaths() {
  const headers = { 'X-Forwarded-Host': host };
  const base = 'http://127.0.0.1:8003';

  const cats = await fetch(`${base}/shop/cats`, { headers }).then((res) => res.json());
  const products = await fetch(`${base}/shop/products?pageSize=1`, { headers }).then((res) => res.json());

  const catSlug = cats.tree?.[0]?.slug;
  const productSlug = products.rows?.[0]?.slug;

  TARGETS[1].path = catSlug ? `/cats/${catSlug}` : null;
  TARGETS[2].path = productSlug ? `/products/${productSlug}` : null;
}

function run(target) {
  return new Promise((resolve, reject) => {
    autocannon(
      {
        url: `http://127.0.0.1:${port}${target.path}`,
        connections,
        duration,
        headers: api ? { 'X-Forwarded-Host': host } : { Host: `${host}:${port}` },
      },
      (err, result) => (err ? reject(err) : resolve(result)),
    );
  });
}

async function main() {
  if (!api) await resolveStorefrontPaths();

  console.log(
    `${api ? 'API' : 'storefront'} :${port}  host=${host}  ${connections} connections, ${duration}s each\n`,
  );
  console.log('page              req/s     avg ms     p50     p97.5      max   non-2xx');
  console.log('-'.repeat(76));

  for (const target of TARGETS) {
    if (!target.path) {
      console.log(`${target.label.padEnd(18)}(no such content in this store, skipped)`);
      continue;
    }

    const result = await run(target);
    const nonSuccess = result.non2xx + result.errors;

    console.log(
      [
        target.label.padEnd(18),
        String(Math.round(result.requests.average)).padStart(5),
        result.latency.average.toFixed(1).padStart(10),
        String(result.latency.p50).padStart(8),
        String(result.latency.p97_5).padStart(8),
        String(result.latency.max).padStart(9),
        String(nonSuccess).padStart(9),
      ].join(''),
    );

    if (nonSuccess > 0) {
      console.log(`  ${nonSuccess} non-2xx/errored responses on ${target.path} — the numbers above are not a clean run`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
