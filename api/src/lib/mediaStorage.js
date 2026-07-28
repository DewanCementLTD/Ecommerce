import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../../../');

export const MEDIA_ROOT = process.env.MEDIA_ROOT
  ? path.resolve(process.env.MEDIA_ROOT)
  : path.join(rootDir, 'media');

export const MEDIA_WIDTHS = [320, 640, 1024, 1600];

/**
 * Every image is stored twice per width: WebP and AVIF.
 *
 * AVIF is roughly 20-30% smaller than WebP at the same quality, which is real
 * money on a product grid over 4G, but it is not universally supported and it
 * is much slower to encode. So both are generated at upload time — once, off
 * the path any shopper waits on — and the serving side picks per request from
 * the browser's `Accept` header (`getPublicMediaFile`).
 *
 * WebP stays first in this list because it is the fallback: images uploaded
 * before Phase 3 have no AVIF variant on disk at all, and serving has to
 * degrade to WebP rather than 404.
 */
export const MEDIA_FORMATS = ['webp', 'avif'];

export function variantPath(storageKey, width, format = 'webp') {
  return path.join(MEDIA_ROOT, `${storageKey}-${width}.${format}`);
}

export async function writeVariant(storageKey, width, buffer, format = 'webp') {
  const filePath = variantPath(storageKey, width, format);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function deleteAllVariants(storageKey) {
  await Promise.all(
    MEDIA_WIDTHS.flatMap((width) =>
      MEDIA_FORMATS.map((format) => unlink(variantPath(storageKey, width, format)).catch(() => {})),
    ),
  );
}
