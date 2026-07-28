/**
 * Dev-only UI checker: screenshots, horizontal-overflow detection, and a few
 * accessibility basics, driven against the real running storefront.
 *
 * Uses the Chrome already installed on the machine via puppeteer-core, so there
 * is no second browser to download. Phase 0's lesson was that a green test
 * suite is not evidence the application renders; this is how that gets checked
 * without opening a browser by hand every time.
 *
 * Usage: node scripts/ui-check.js <url> [...urls]  (env: WIDTHS, OUT)
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME =
  process.env.CHROME_PATH ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../');
const outDir = process.env.OUT ?? path.join(rootDir, '.ui-check');
const widths = (process.env.WIDTHS ?? '375,1440').split(',').map(Number);

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Usage: node scripts/ui-check.js <url> [...urls]');
  process.exit(1);
}

/** Runs in the page: what is wider than the viewport, and what is unlabelled. */
function auditInPage() {
  const docWidth = document.documentElement.scrollWidth;
  const viewport = document.documentElement.clientWidth;

  const offenders = [];
  if (docWidth > viewport + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const rect = el.getBoundingClientRect();
      if (rect.right > viewport + 1 && rect.width > 0) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className?.toString?.() ?? '').slice(0, 90),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
      }
    }
  }

  const imagesWithoutAlt = [...document.querySelectorAll('img')].filter(
    (img) => !img.hasAttribute('alt'),
  ).length;

  const buttonsWithoutName = [...document.querySelectorAll('button')].filter(
    (btn) => !btn.textContent.trim() && !btn.getAttribute('aria-label'),
  ).length;

  const h1s = document.querySelectorAll('h1').length;
  const brokenImages = [...document.querySelectorAll('img')].filter(
    (img) => img.complete && img.naturalWidth === 0,
  ).length;

  // Cheap SEO essentials, checked in the same pass. Lighthouse scores these
  // too but will not say which page failed when you are checking six at once.
  // Scoped to <head> on purpose. A <meta> streamed into <body> still works in
  // a browser (it gets hoisted), but Lighthouse's SEO audits and strict
  // crawlers read `head meta` — so "present somewhere in the document" is the
  // wrong question, and asking it hid a real defect for a while.
  const metaDescription = document.querySelector('head meta[name="description"]')?.content?.trim() ?? '';
  const canonical = document.querySelector('head link[rel="canonical"]')?.href ?? '';

  return {
    metaDescription,
    canonical,
    docWidth,
    viewport,
    overflow: docWidth > viewport + 1,
    offenders: offenders.slice(0, 6),
    imagesWithoutAlt,
    buttonsWithoutName,
    h1s,
    brokenImages,
    lang: document.documentElement.lang,
    dir: document.documentElement.dir,
  };
}

async function run() {
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars'],
  });

  let failures = 0;

  for (const url of urls) {
    for (const width of widths) {
      const page = await browser.newPage();

      /*
       * Console errors, page exceptions and failed sub-requests.
       *
       * Lighthouse scores "browser errors were logged to the console" but will
       * not tell you which, and a storefront that renders correctly while
       * throwing on hydration is a storefront one browser version away from
       * not rendering at all. Collected here because this script is already
       * driving a real browser at the real page.
       */
      const consoleProblems = [];
      page.on('console', (message) => {
        if (message.type() === 'error') consoleProblems.push(`console: ${message.text().slice(0, 160)}`);
      });
      page.on('pageerror', (err) => consoleProblems.push(`exception: ${err.message.slice(0, 160)}`));
      page.on('requestfailed', (request) => {
        const reason = request.failure()?.errorText ?? 'unknown';
        // ERR_ABORTED on a `?_rsc=` URL is Next cancelling its own link
        // prefetch once it has what it needs — normal browser behaviour, not a
        // fault, and reporting it would train everyone to ignore this list.
        if (reason === 'net::ERR_ABORTED' && request.url().includes('_rsc=')) return;
        consoleProblems.push(`request failed (${reason}): ${request.url().slice(0, 110)}`);
      });
      page.on('response', (response) => {
        if (response.status() >= 400) {
          consoleProblems.push(`http ${response.status()}: ${response.url().slice(0, 120)}`);
        }
      });

      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

      const audit = await page.evaluate(auditInPage);
      const name = `${url.replace(/https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-')}-${width}`;
      await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });

      const problems = [];
      if (audit.overflow) problems.push(`overflows (${audit.docWidth}px > ${audit.viewport}px)`);
      if (audit.imagesWithoutAlt) problems.push(`${audit.imagesWithoutAlt} img without alt`);
      if (audit.buttonsWithoutName) problems.push(`${audit.buttonsWithoutName} unnamed button`);
      if (audit.brokenImages) problems.push(`${audit.brokenImages} broken image`);
      if (audit.h1s !== 1) problems.push(`${audit.h1s} h1 elements`);
      if (consoleProblems.length) problems.push(`${consoleProblems.length} console error(s)`);
      if (!audit.metaDescription) problems.push('no meta description');
      if (!audit.canonical) problems.push('no canonical');

      if (problems.length) failures += 1;
      console.log(
        `${problems.length ? 'FAIL' : ' ok '}  ${width}px  ${url}  ${problems.join('; ') || `lang=${audit.lang} dir=${audit.dir}`}`,
      );
      for (const offender of audit.offenders) {
        console.log(`         -> <${offender.tag}> w=${offender.width} right=${offender.right} ${offender.cls}`);
      }
      for (const problem of [...new Set(consoleProblems)].slice(0, 6)) {
        console.log(`         -> ${problem}`);
      }

      await page.close();
    }
  }

  await browser.close();
  console.log(`\nScreenshots in ${outDir}`);
  process.exitCode = failures > 0 ? 1 : 0;
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
