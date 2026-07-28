import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { MEDIA_ROOT, MEDIA_WIDTHS, variantPath } from '../api/src/lib/mediaStorage.js';

/**
 * One-time, idempotent: generate the AVIF sibling of every WebP variant that
 * does not have one.
 *
 * Phase 3 made uploads write both formats so the storefront can negotiate
 * between them, but every image uploaded before that is WebP-only. Serving
 * falls back to WebP for those, so nothing is broken without this — they
 * simply never get the smaller file. This walks the media directory rather
 * than the database on purpose: the files on disk are the thing being
 * backfilled, and it needs no company context, no VPD, and no connection pool
 * to do it.
 *
 * Safe to re-run: an existing .avif is left alone.
 *
 *   node scripts/backfill-avif.js
 */

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return;
    throw err;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith('.webp')) {
      yield full;
    }
  }
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  let seen = 0;
  let written = 0;
  let skipped = 0;

  for await (const webpPath of walk(MEDIA_ROOT)) {
    seen += 1;

    // `<storageKey>-<width>.webp` — the width is already baked in, so the AVIF
    // is a straight re-encode of the resized file rather than another resize
    // of an original we no longer keep.
    const avifPath = webpPath.replace(/\.webp$/, '.avif');
    if (await exists(avifPath)) {
      skipped += 1;
      continue;
    }

    const match = webpPath.match(/-(\d+)\.webp$/);
    if (!match || !MEDIA_WIDTHS.includes(Number(match[1]))) {
      console.warn(`skipping ${webpPath}: not a recognised variant width`);
      skipped += 1;
      continue;
    }

    const storageKey = webpPath.slice(MEDIA_ROOT.length + 1).replace(/-\d+\.webp$/, '').split(path.sep).join('/');
    const buffer = await sharp(webpPath).avif({ effort: 4 }).toBuffer();
    const { writeFile } = await import('node:fs/promises');
    await writeFile(variantPath(storageKey, Number(match[1]), 'avif'), buffer);
    written += 1;
  }

  console.log(`media root: ${MEDIA_ROOT}`);
  console.log(`webp variants seen: ${seen}, avif written: ${written}, already present: ${skipped}`);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
