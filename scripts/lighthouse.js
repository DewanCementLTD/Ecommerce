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

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Usage: node scripts/lighthouse.js <url> [...urls]');
  process.exit(1);
}

const TARGETS = { performance: 85, accessibility: 95, 'best-practices': 90, seo: 90 };

async function run() {
  const browser = await launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--remote-debugging-port=9222'],
  });

  const port = Number(new URL(browser.wsEndpoint()).port);
  let failures = 0;

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
        if (target && value < target) failures += 1;
        return `${key}=${mark}`;
      })
      .join('  ');

    console.log(`${url}\n  ${line}`);

    const opportunities = result.lhr.audits;
    for (const key of ['largest-contentful-paint', 'cumulative-layout-shift', 'total-blocking-time']) {
      if (opportunities[key]) console.log(`  ${key}: ${opportunities[key].displayValue}`);
    }
  }

  await browser.close();
  process.exitCode = failures > 0 ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
