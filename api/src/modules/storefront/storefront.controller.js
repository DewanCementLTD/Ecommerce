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

    /**
     * The logo's intrinsic size travels with its URL.
     *
     * Every other image on the storefront sits in a box with a CSS aspect
     * ratio, so the browser reserves its space before the bytes arrive. The
     * header logo is the exception — `h-9 w-auto`, width unknown until it
     * loads — which makes it the one image on the page that can still shift
     * the layout. Sending its real dimensions lets the header reserve the
     * right width up front.
     */
    let logo = null;
    if (logoMediaId) {
      try {
        const media = await getMedia({ companyId: req.companyId, id: logoMediaId });
        logo = { width: media.WIDTH ?? null, height: media.HEIGHT ?? null };
      } catch {
        // A logo pointing at a deleted media row is a data problem, not a
        // reason to fail every page of the store.
        logo = null;
      }
    }

    res.json({
      company: {
        ...rest,
        logoUrl: logoMediaId ? `/storefront/media/${logoMediaId}/file` : null,
        logoWidth: logo?.width ?? null,
        logoHeight: logo?.height ?? null,
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

    /**
     * Content negotiation, not a second URL.
     *
     * One `<img src>` per image keeps the markup, the srcSet and the sitemap
     * simple; the format is chosen here from what the browser says it accepts.
     * AVIF is preferred when offered and present on disk — images uploaded
     * before Phase 3 have no AVIF variant, so a missing file falls back to
     * WebP rather than 404ing.
     *
     * `Vary: Accept` is mandatory: without it, a shared cache (Nginx,
     * Cloudflare) would happily serve an AVIF body to a browser that asked for
     * WebP, because the URL is identical.
     */
    const wantsAvif = String(req.headers.accept ?? '').includes('image/avif');
    res.setHeader('Vary', 'Accept');

    let format = 'webp';
    if (wantsAvif) {
      try {
        await stat(variantPath(media.STORAGE_KEY, width, 'avif'));
        format = 'avif';
      } catch {
        format = 'webp';
      }
    }

    const filePath = variantPath(media.STORAGE_KEY, width, format);
    await stat(filePath);
    res.type(`image/${format}`);
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return next(new AppError(404, 'MEDIA_FILE_NOT_FOUND', 'That size was not generated for this image.'));
    }
    next(err);
  }
}
