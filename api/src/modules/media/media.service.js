import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { MEDIA_WIDTHS, writeVariant } from '../../lib/mediaStorage.js';
import {
  insertMedia,
  listMedia as listMediaRows,
  findMediaById,
  updateMedia as updateMediaRow,
  softDeleteMedia,
} from './media.repo.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function uploadMedia({ companyId, buffer, originalFilename, alt, folder }) {
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(400, 'FILE_TOO_LARGE', 'Images must be 10MB or smaller.');
  }

  const type = await fileTypeFromBuffer(buffer);
  if (!type || !ALLOWED_MIME.has(type.mime)) {
    throw new AppError(400, 'INVALID_FILE_TYPE', 'Only jpg, png, webp, or avif images are allowed.');
  }

  const metadata = await sharp(buffer).metadata();
  const storageKey = `${companyId}/${randomUUID()}`;

  const widthsToGenerate = MEDIA_WIDTHS.filter((w) => w <= (metadata.width ?? w));
  if (widthsToGenerate.length === 0) {
    widthsToGenerate.push(MEDIA_WIDTHS[0]);
  }

  for (const width of widthsToGenerate) {
    // sharp() strips EXIF/metadata by default (only kept if .withMetadata() is called)
    const variantBuffer = await sharp(buffer).resize({ width, withoutEnlargement: true }).webp().toBuffer();
    await writeVariant(storageKey, width, variantBuffer);
  }

  return withCompany(companyId, async (conn) => {
    const id = await insertMedia(conn, {
      companyId,
      filename: originalFilename,
      alt: alt ?? null,
      mime: 'image/webp',
      sizeBytes: buffer.length,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      folder: folder ?? null,
      storageKey,
    });
    await conn.commit();
    return findMediaById(conn, { companyId, id });
  });
}

export async function listMedia({ companyId, page, pageSize, search, folder }) {
  const { rows, total } = await withCompany(companyId, (conn) =>
    listMediaRows(conn, { companyId, page, pageSize, search, folder }),
  );
  return { rows, total, page, pageSize };
}

export async function getMedia({ companyId, id }) {
  const row = await withCompany(companyId, (conn) => findMediaById(conn, { companyId, id }));
  if (!row) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found.');
  }
  return row;
}

export async function patchMedia({ companyId, id, alt, folder }) {
  const existing = await getMedia({ companyId, id });
  const nextAlt = alt !== undefined ? alt : existing.ALT;
  const nextFolder = folder !== undefined ? folder : existing.FOLDER;

  const updated = await withCompany(companyId, async (conn) => {
    const row = await updateMediaRow(conn, { companyId, id, alt: nextAlt, folder: nextFolder });
    await conn.commit();
    return row;
  });
  if (!updated) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found.');
  }
  return updated;
}

export async function deleteMedia({ companyId, id }) {
  const deleted = await withCompany(companyId, async (conn) => {
    const wasDeleted = await softDeleteMedia(conn, { companyId, id });
    await conn.commit();
    return wasDeleted;
  });
  if (!deleted) {
    throw new AppError(404, 'MEDIA_NOT_FOUND', 'Media not found.');
  }
}
