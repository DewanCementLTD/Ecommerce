import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(import.meta.url), '../../../../');

export const MEDIA_ROOT = process.env.MEDIA_ROOT
  ? path.resolve(process.env.MEDIA_ROOT)
  : path.join(rootDir, 'media');

export const MEDIA_WIDTHS = [320, 640, 1024, 1600];

export function variantPath(storageKey, width) {
  return path.join(MEDIA_ROOT, `${storageKey}-${width}.webp`);
}

export async function writeVariant(storageKey, width, buffer) {
  const filePath = variantPath(storageKey, width);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
}

export async function deleteAllVariants(storageKey) {
  await Promise.all(MEDIA_WIDTHS.map((width) => unlink(variantPath(storageKey, width)).catch(() => {})));
}
