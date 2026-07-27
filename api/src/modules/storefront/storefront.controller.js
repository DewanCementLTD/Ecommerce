import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { getMedia } from '../media/media.service.js';
import { MEDIA_WIDTHS, variantPath } from '../../lib/mediaStorage.js';
import { AppError } from '../../middleware/error.js';

export function getCompanyInfo(req, res) {
  const { logoMediaId, ...rest } = req.company;
  res.json({
    company: {
      ...rest,
      logoUrl: logoMediaId ? `/storefront/media/${logoMediaId}/file` : null,
    },
  });
}

/**
 * Public (no auth), but still tenant-scoped: companyId comes from the
 * already-resolved host (tenantResolver), never from the client, so this
 * can only ever serve the resolved store's own media.
 */
export async function getPublicMediaFile(req, res, next) {
  try {
    const media = await getMedia({ companyId: req.companyId, id: Number(req.params.id) });
    const requestedWidth = req.query.width ? Number(req.query.width) : undefined;
    const width = MEDIA_WIDTHS.includes(requestedWidth)
      ? requestedWidth
      : (MEDIA_WIDTHS.filter((w) => w <= (media.WIDTH ?? w)).at(-1) ?? MEDIA_WIDTHS[0]);

    const filePath = variantPath(media.STORAGE_KEY, width);
    await stat(filePath);
    res.type('image/webp');
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return next(new AppError(404, 'MEDIA_FILE_NOT_FOUND', 'That size was not generated for this image.'));
    }
    next(err);
  }
}
