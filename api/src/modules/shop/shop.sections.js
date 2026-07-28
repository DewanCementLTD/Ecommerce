import { getSection } from '@storeforge/shared';
import * as contentService from '../content/content.service.js';
import * as catsService from '../cats/cats.service.js';
import * as productsService from '../products/products.service.js';
import * as collsService from '../colls/colls.service.js';
import { imageUrl, toCard } from './shop.dto.js';

/**
 * Turns a page's stored sections into everything needed to render them.
 *
 * Each section's `settings` names ids; this resolves those into rows, so the
 * storefront makes one request for a page instead of one per section. A section
 * whose data is missing resolves to empty rather than throwing: a deleted banner
 * or category must leave a quiet gap, never a broken page.
 *
 * All lookups go through the catalog services, so the tenant scoping and the
 * active-only rules are the same ones the rest of the shop API uses.
 */

const PRODUCT_LIMIT_CAP = 24;

/**
 * Media ids in a section's settings become urls before they leave the API, so
 * no storefront component has to know how media is addressed.
 */
function withMediaUrls(type, settings) {
  const resolved = { ...settings };

  if (settings.mediaId !== undefined) resolved.mediaUrl = imageUrl(settings.mediaId);
  if (settings.mediaMobileId !== undefined) resolved.mediaMobileUrl = imageUrl(settings.mediaMobileId);
  if (settings.backgroundMediaId !== undefined) {
    resolved.backgroundMediaUrl = imageUrl(settings.backgroundMediaId);
  }
  if (type === 'features' && Array.isArray(settings.items)) {
    resolved.items = settings.items.map((item) => ({ ...item, mediaUrl: imageUrl(item.mediaId) }));
  }

  return resolved;
}

async function resolveProducts(companyId, settings) {
  const limit = Math.min(settings.limit ?? 8, PRODUCT_LIMIT_CAP);
  const base = { companyId, page: 1, pageSize: limit, isActive: 1, sort: 'created', dir: 'desc' };

  switch (settings.source) {
    case 'collection': {
      if (!settings.collId) return [];
      try {
        const result = await collsService.listCollProducts({
          companyId,
          id: settings.collId,
          page: 1,
          pageSize: limit,
          activeOnly: true,
        });
        return result.rows.map(toCard);
      } catch {
        // The collection was deleted after the section was configured.
        return [];
      }
    }
    case 'category': {
      if (!settings.catId) return [];
      return (await productsService.listProducts({ ...base, catId: settings.catId })).rows.map(toCard);
    }
    case 'manual': {
      const ids = settings.productIds ?? [];
      if (ids.length === 0) return [];
      const { rows } = await productsService.listProducts({ ...base, ids, pageSize: ids.length });
      // Keep the order the admin chose, which the SQL sort does not preserve.
      const byId = new Map(rows.map((row) => [row.id, toCard(row)]));
      return ids.map((id) => byId.get(id)).filter(Boolean);
    }
    case 'featured':
      return (await productsService.listProducts({ ...base, isFeatured: 1 })).rows.map(toCard);
    case 'newest':
    default:
      return (await productsService.listProducts(base)).rows.map(toCard);
  }
}

async function resolveBanners(companyId, ids) {
  if (!ids?.length) return [];
  const { rows } = await contentService.listBanners({ companyId, live: true, ids });
  // listBanners orders by position; keep the admin's chosen order instead.
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        alt: row.alt,
        link: row.link,
        // A separate mobile crop, because a desktop hero looks wrong on a phone
        // and phones are most of the traffic.
        url: imageUrl(row.mediaId),
        mobileUrl: imageUrl(row.mediaMobileId) ?? imageUrl(row.mediaId),
      },
    ]),
  );
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

async function resolveCats(companyId, ids) {
  if (!ids?.length) return [];
  const { rows } = await catsService.listCats({ companyId, isActive: 1 });
  const byId = new Map(rows.map((row) => [row.id, { ...row, imageUrl: imageUrl(row.imageId) }]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * @returns {Promise<Array<{id: number, type: string, settings: object, data: object}>>}
 */
export async function resolveSections({ companyId, sections }) {
  const resolved = [];

  for (const section of sections) {
    // A type no longer in the registry (renamed, removed) is skipped rather
    // than rendered as an unknown blob.
    if (!getSection(section.type)) continue;

    const settings = withMediaUrls(section.type, section.settings ?? {});
    let data = {};

    switch (section.type) {
      case 'hero':
        data = { banners: await resolveBanners(companyId, settings.bannerIds) };
        break;
      case 'cat_tiles':
        data = { cats: await resolveCats(companyId, settings.catIds) };
        break;
      case 'prod_row':
        data = { products: await resolveProducts(companyId, settings) };
        break;
      case 'best':
        // No order history until Phase 2, so "best sellers" shows featured
        // products. The registry's help text says so in the admin.
        data = {
          products: await resolveProducts(companyId, { source: 'featured', limit: settings.limit }),
        };
        break;
      case 'blog':
        // There is no blog in this phase. Empty data means the section renders
        // nothing at all rather than an empty heading.
        data = { posts: [] };
        break;
      default:
        data = {};
    }

    resolved.push({ id: section.id, type: section.type, settings, data });
  }

  return resolved;
}
