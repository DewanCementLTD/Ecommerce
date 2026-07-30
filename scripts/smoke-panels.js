import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

/**
 * Logs into an admin panel and walks its screens, reporting anything the
 * browser complained about.
 *
 * A React SPA that builds and lints clean can still throw on the first render
 * — every phase of this project has found bugs that way and no other way.
 * `ui:check` covers the storefront, which needs no login; this covers the two
 * panels, which do.
 *
 *   node scripts/smoke-panels.js <baseUrl> <email> <password> [path ...]
 *
 * Example:
 *   node scripts/smoke-panels.js http://localhost:4000 super@x.test 'pw' \
 *     /dashboard /companies /logs
 */

const CHROME = process.env.CHROME_PATH ?? String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

const [baseUrl, email, password, ...paths] = process.argv.slice(2);

if (!baseUrl || !email || !password) {
  console.error('Usage: node scripts/smoke-panels.js <baseUrl> <email> <password> [path ...]');
  process.exit(1);
}

const routes = paths.length ? paths : ['/'];
const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
const outDir = process.env.OUT ?? path.join(rootDir, '.ui-check');

async function run() {
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox'],
  });

  let failures = 0;

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const problems = [];
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 160)}`);
    });
    page.on('pageerror', (err) => problems.push(`exception: ${err.message.slice(0, 160)}`));
    page.on('response', (res) => {
      if (res.status() >= 400 && !res.url().includes('favicon')) {
        problems.push(`http ${res.status()}: ${res.url().slice(0, 110)}`);
      }
    });

    /*
     * `domcontentloaded`, not `networkidle2`. A panel that polls — the Super
     * Admin dashboard refreshes every 60s — never reaches network idle, and
     * the walk below timed out on a page that had rendered perfectly well.
     * The explicit settle after each navigation is what waits for the SPA.
     */
    await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });

    await page.type('input[type="email"]', email);
    await page.type('input[type="password"]', password);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {
        // An SPA login is a client-side route change, not a navigation.
      }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const loggedIn = await page.evaluate(() => !window.location.pathname.startsWith('/login'));
    if (!loggedIn) {
      console.log('FAIL  login did not leave /login — wrong credentials, or the form did not submit');
      failures += 1;
    }

    for (const route of routes) {
      problems.length = 0;
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const summary = await page.evaluate(() => ({
        heading: document.querySelector('h1')?.textContent?.trim() ?? null,
        // An error boundary or a blank screen both leave a page with almost
        // no text; "it returned 200" is not the same as "it rendered".
        textLength: document.body.innerText.trim().length,
      }));

      const issues = [];
      if (!summary.heading) issues.push('no h1');
      if (summary.textLength < 60) issues.push(`almost no content (${summary.textLength} chars)`);
      if (problems.length) issues.push(`${problems.length} browser error(s)`);

      const name = `panel-${route.replace(/[^a-z0-9]+/gi, '-') || 'root'}`;
      await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });

      if (issues.length) failures += 1;
      console.log(
        `${issues.length ? 'FAIL' : ' ok '}  ${route.padEnd(24)} ${
          issues.join('; ') || `h1="${summary.heading}"`
        }`,
      );
      for (const problem of [...new Set(problems)].slice(0, 5)) {
        console.log(`         -> ${problem}`);
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nScreenshots in ${outDir}`);
  process.exitCode = failures > 0 ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
