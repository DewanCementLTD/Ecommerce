/**
 * Mobile Lighthouse against a running production build.
 *
 * Must be pointed at `next build && next start`, never the dev server: dev mode
 * ships unminified bundles and compiles on demand, so its numbers say nothing
 * about what a shopper would get.
 *
 * Usage: node scripts/lighthouse.js <url> [...urls]
 */
import { launch } from 'puppeteer-core';
import lighthouse from 'lighthouse';

const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const urls = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (urls.length === 0) {
  console.error('Usage: node scripts/lighthouse.js <url> [...urls]');
  process.exit(1);
}

/**
 * Phase 3's exit criteria, not Phase 1's. The performance and SEO bars moved
 * up (docs/04-PHASE-3-launch.md), so this script fails against the numbers the
 * project is actually held to now.
 */
const TARGETS = { performance: 90, accessibility: 95, 'best-practices': 90, seo: 95 };

async function run() {
  const browser = await launch({
    executablePath: CHROME,
    headless: 'new',
    /*
     * No fixed --remote-debugging-port. Pinning it to 9222 meant a second run
     * could not start while an earlier headless Chrome was still alive (a
     * timed-out run, a crashed one), and the failure mode was this script
     * hanging forever with no output. Puppeteer picks a free port and the
     * real one is read back from wsEndpoint() below.
     */
    args: ['--no-sandbox'],
  });

  const port = Number(new URL(browser.wsEndpoint()).port);
  let failures = 0;

  try {
    await audit(browser, port, urls, (n) => { failures += n; });
  } finally {
    // Always: a headless Chrome left running is the reason the next run hangs.
    await browser.close();
  }

  process.exitCode = failures > 0 ? 1 : 0;
}

async function audit(browser, port, urls, addFailures) {
  for (const url of urls) {
    const result = await lighthouse(
      url,
      { port, output: 'json', logLevel: 'error', screenEmulation: { mobile: true } },
      undefined,
    );

    const scores = Object.fromEntries(
      Object.entries(result.lhr.categories).map(([key, category]) => [
        key,
        Math.round(category.score * 100),
      ]),
    );

    const line = Object.entries(scores)
      .map(([key, value]) => {
        const target = TARGETS[key];
        const mark = target && value < target ? `${value}<${target}` : `${value}`;
        if (target && value < target) addFailures(1);
        return `${key}=${mark}`;
      })
      .join('  ');

    // The URL Lighthouse actually audited. Worth printing: on a multi-tenant
    // storefront a redirect (secondary domain → primary) means the scores
    // belong to a different page than the one you asked about.
    const finalUrl = result.lhr.finalDisplayedUrl ?? result.lhr.finalUrl;
    const redirected = finalUrl && finalUrl !== url ? `  (loaded ${finalUrl})` : '';
    console.log(`${url}${redirected}\n  ${line}`);

    // AUDIT=meta-description npm run … — dumps one audit's raw result, for
    // when a score disagrees with what the page obviously contains.
    if (process.env.AUDIT) {
      console.log(JSON.stringify(result.lhr.audits[process.env.AUDIT], null, 2).slice(0, 1600));
    }

    const audits = result.lhr.audits;
    for (const key of ['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time']) {
      if (audits[key]) console.log(`  ${key}: ${audits[key].displayValue}`);
    }

    /*
     * A score on its own is not actionable — "performance=76" tells you to go
     * looking, not what to fix. `--why` lists the audits that actually lost
     * points, worst first, which is the difference between measuring and
     * diagnosing.
     */
    if (process.argv.includes('--why')) {
      const failed = Object.values(audits)
        .filter((audit) => audit.score !== null && audit.score < 0.9 && audit.scoreDisplayMode !== 'notApplicable')
        .sort((a, b) => a.score - b.score);

      for (const audit of failed) {
        const detail = audit.displayValue ? ` — ${audit.displayValue}` : '';
        console.log(`    [${audit.score.toFixed(2)}] ${audit.title}${detail}`);
      }
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
