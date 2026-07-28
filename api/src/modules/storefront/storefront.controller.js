import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { getMedia } from '../media/media.service.js';
import { getSettings } from '../settings/settings.service.js';
import { MEDIA_WIDTHS, variantPath } from '../../lib/mediaStorage.js';
import { AppError } from '../../middleware/error.js';

/**
 * Everything the storefront's chrome and its `<head>` need, in one call.
 *
 * The SEO defaults come from `settings` rather than from anything hardcoded:
 * `seo_title`/`seo_description` are seeded at provisioning and edited in the
 * client admin, and every page's metadata falls back to them.
 */
export async function getCompanyInfo(req, res, next) {
  try {
    const { logoMediaId, ...rest } = req.company;
    const { settings } = await getSettings({ companyId: req.companyId });

    res.json({
      company: {
        ...rest,
        logoUrl: logoMediaId ? `/storefront/media/${logoMediaId}/file` : null,
        seoTitle: settings.seo_title || null,
        seoDescription: settings.seo_description || null,
        ogImageUrl: settings.seo_og_media_id
          ? `/storefront/media/${settings.seo_og_media_id}/file`
          : null,
        social: {
          facebook: settings.social_facebook || null,
          instagram: settings.social_instagram || null,
          twitter: settings.social_twitter || null,
        },
      },
    });
  } catch (err) {
    next(err);
  }
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
