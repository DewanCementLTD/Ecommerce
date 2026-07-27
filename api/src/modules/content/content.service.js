import { isSectionType, normalizeSettings, defaultSettings } from '@storeforge/shared';
import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { slugify, resolveSlug } from '../../lib/slug.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import { parseJson, stringifyJson } from '../../lib/json.js';
import { buildTree, findCycle } from '../../lib/tree.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/dbErrors.js';
import * as repo from './content.repo.js';

function rethrowAsBadReference(err) {
  if (isForeignKeyViolation(err, 'pages_og_image_fk')) {
    throw new AppError(400, 'IMAGE_NOT_FOUND', 'That image does not exist in this store.');
  }
  if (isForeignKeyViolation(err, 'banners_media_fk') || isForeignKeyViolation(err, 'banners_media_mobile_fk')) {
    throw new AppError(400, 'IMAGE_NOT_FOUND', 'That image does not exist in this store.');
  }
  if (isUniqueViolation(err, 'pages_one_home_uq')) {
    throw new AppError(409, 'HOME_PAGE_EXISTS', 'This store already has a home page.');
  }
  throw err;
}

/* -------------------------------------------------------------------- pages */

function toPageDto(row) {
  return camelRow(row);
}

async function nextFreeSlug(conn, { companyId, desired, fallbackFrom, excludeId }) {
  const base = desired ? slugify(desired) : slugify(fallbackFrom);
  const taken = await repo.findSlugsStartingWith(conn, { companyId, base, excludeId });
  return resolveSlug(base, taken);
}

export async function createPage({ companyId, ...input }) {
  const pageId = await withCompany(companyId, async (conn) => {
    try {
      const slug = await nextFreeSlug(conn, { companyId, desired: input.slug, fallbackFrom: input.title });
      const id = await repo.insertPage(conn, {
        companyId,
        title: input.title,
        slug,
        // Only provisioning creates the home page; everything the admin adds is
        // an ordinary page, which is what pages_one_home_uq is there to protect.
        type: 'page',
        content: input.content ?? null,
        isActive: input.isActive ?? 1,
        metaTitle: input.metaTitle ?? null,
        metaDesc: input.metaDesc ?? null,
        ogImageId: input.ogImageId ?? null,
      });
      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getPage({ companyId, id: pageId });
}

export async function listPages({ companyId, isActive }) {
  const rows = await withCompany(companyId, (conn) => repo.listPages(conn, { companyId, isActive }));
  return { rows: camelRows(rows) };
}

export async function getPage({ companyId, id }) {
  const row = await withCompany(companyId, (conn) => repo.findPageById(conn, { companyId, id }));
  if (!row) {
    throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
  }
  return toPageDto(row);
}

export async function patchPage({ companyId, id, ...input }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findPageById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
    }

    try {
      const renaming = input.slug !== undefined || (input.title !== undefined && input.title !== existing.TITLE);
      const slug = renaming
        ? await nextFreeSlug(conn, {
            companyId,
            desired: input.slug ?? input.title,
            fallbackFrom: input.title ?? existing.TITLE,
            excludeId: id,
          })
        : existing.SLUG;

      await repo.updatePage(conn, {
        id,
        companyId,
        title: input.title ?? existing.TITLE,
        slug,
        content: input.content !== undefined ? input.content : existing.CONTENT,
        isActive: input.isActive ?? existing.IS_ACTIVE,
        metaTitle: input.metaTitle !== undefined ? input.metaTitle : existing.META_TITLE,
        metaDesc: input.metaDesc !== undefined ? input.metaDesc : existing.META_DESC,
        ogImageId: input.ogImageId !== undefined ? (input.ogImageId ?? null) : existing.OG_IMAGE_ID,
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getPage({ companyId, id });
}

export async function deletePage({ companyId, id }) {
  return withCompany(companyId, async (conn) => {
    const existing = await repo.findPageById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
    }
    // The home page is what "/" renders; deleting it would leave the storefront
    // with nothing to show and no way back through the UI.
    if (existing.TYPE === 'home') {
      throw new AppError(409, 'HOME_PAGE_PROTECTED', 'The home page cannot be deleted.');
    }

    const removedSections = await repo.deleteSectionsByPage(conn, { companyId, pageId: id });
    await repo.deletePageById(conn, { companyId, id });
    await conn.commit();
    return { removedSections };
  });
}

/* ----------------------------------------------------------------- sections */

function toSectionDto(row) {
  const section = camelRow(row);
  // Normalising on read means a section stored before a registry field existed
  // still arrives with every key the components expect.
  section.settings = normalizeSettings(section.type, parseJson(section.settings, {}));
  return section;
}

async function assertPageExists(conn, { companyId, pageId }) {
  const page = await repo.findPageById(conn, { companyId, id: pageId });
  if (!page) {
    throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
  }
  return page;
}

export async function listSections({ companyId, pageId, isActive }) {
  const rows = await withCompany(companyId, async (conn) => {
    await assertPageExists(conn, { companyId, pageId });
    return repo.listSections(conn, { companyId, pageId, isActive });
  });
  return { rows: rows.map(toSectionDto) };
}

export async function addSection({ companyId, pageId, type, position, isActive, settings }) {
  if (!isSectionType(type)) {
    throw new AppError(400, 'UNKNOWN_SECTION_TYPE', `There is no section type called "${type}".`);
  }

  await withCompany(companyId, async (conn) => {
    await assertPageExists(conn, { companyId, pageId });
    const nextPosition = position ?? (await repo.nextSectionPosition(conn, { companyId, pageId }));

    await repo.insertSection(conn, {
      companyId,
      pageId,
      type,
      position: nextPosition,
      isActive: isActive ?? 1,
      settings: stringifyJson(normalizeSettings(type, settings ?? defaultSettings(type))),
    });
    await conn.commit();
  });

  return listSections({ companyId, pageId });
}

export async function patchSection({ companyId, id, isActive, settings }) {
  const pageId = await withCompany(companyId, async (conn) => {
    const existing = await repo.findSectionById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'SECTION_NOT_FOUND', 'Section not found.');
    }

    const merged =
      settings !== undefined
        ? normalizeSettings(existing.TYPE, { ...parseJson(existing.SETTINGS, {}), ...settings })
        : normalizeSettings(existing.TYPE, parseJson(existing.SETTINGS, {}));

    await repo.updateSection(conn, {
      companyId,
      id,
      isActive: isActive ?? existing.IS_ACTIVE,
      settings: stringifyJson(merged),
    });
    await conn.commit();
    return existing.PAGE_ID;
  });

  return listSections({ companyId, pageId });
}

export async function deleteSection({ companyId, id }) {
  const pageId = await withCompany(companyId, async (conn) => {
    const existing = await repo.findSectionById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'SECTION_NOT_FOUND', 'Section not found.');
    }
    await repo.deleteSectionById(conn, { companyId, id });
    await conn.commit();
    return existing.PAGE_ID;
  });

  return listSections({ companyId, pageId });
}

/**
 * The drag-and-drop save. Every position is written in one transaction, so the
 * arranger either lands exactly as dropped or not at all — which is what makes
 * the admin's optimistic reorder safe to roll back.
 */
export async function reorderSections({ companyId, pageId, items }) {
  await withCompany(companyId, async (conn) => {
    await assertPageExists(conn, { companyId, pageId });

    const owned = new Set(
      (await repo.listSections(conn, { companyId, pageId })).map((row) => row.ID),
    );
    for (const item of items) {
      if (!owned.has(item.id)) {
        throw new AppError(404, 'SECTION_NOT_FOUND', `Section ${item.id} is not on this page.`);
      }
    }

    for (const item of items) {
      await repo.updateSectionPosition(conn, { companyId, pageId, id: item.id, position: item.position });
    }
    await conn.commit();
  });

  return listSections({ companyId, pageId });
}

/* ------------------------------------------------------------------ banners */

function toBannerDto(row) {
  return camelRow(row);
}

export async function createBanner({ companyId, ...input }) {
  const bannerId = await withCompany(companyId, async (conn) => {
    try {
      const id = await repo.insertBanner(conn, {
        companyId,
        name: input.name,
        mediaId: input.mediaId ?? null,
        mediaMobileId: input.mediaMobileId ?? null,
        link: input.link ?? null,
        alt: input.alt ?? null,
        position: input.position ?? 0,
        isActive: input.isActive ?? 1,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      });
      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getBanner({ companyId, id: bannerId });
}

export async function listBanners({ companyId, isActive, live, ids }) {
  const rows = await withCompany(companyId, (conn) =>
    repo.listBanners(conn, { companyId, isActive, liveOnly: live, ids }),
  );
  return { rows: rows.map(toBannerDto) };
}

export async function getBanner({ companyId, id }) {
  const row = await withCompany(companyId, (conn) => repo.findBannerById(conn, { companyId, id }));
  if (!row) {
    throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found.');
  }
  return toBannerDto(row);
}

export async function patchBanner({ companyId, id, ...input }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findBannerById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found.');
    }

    try {
      await repo.updateBanner(conn, {
        id,
        companyId,
        name: input.name ?? existing.NAME,
        mediaId: input.mediaId !== undefined ? (input.mediaId ?? null) : existing.MEDIA_ID,
        mediaMobileId:
          input.mediaMobileId !== undefined ? (input.mediaMobileId ?? null) : existing.MEDIA_MOBILE_ID,
        link: input.link !== undefined ? input.link : existing.LINK,
        alt: input.alt !== undefined ? input.alt : existing.ALT,
        position: input.position ?? existing.POSITION,
        isActive: input.isActive ?? existing.IS_ACTIVE,
        startsAt: input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : existing.STARTS_AT,
        endsAt: input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : existing.ENDS_AT,
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getBanner({ companyId, id });
}

export async function deleteBanner({ companyId, id }) {
  const deleted = await withCompany(companyId, async (conn) => {
    const wasDeleted = await repo.deleteBannerById(conn, { companyId, id });
    if (wasDeleted) await conn.commit();
    return wasDeleted;
  });
  if (!deleted) {
    throw new AppError(404, 'BANNER_NOT_FOUND', 'Banner not found.');
  }
}

/* --------------------------------------------------------------------- menus */

export async function listMenus({ companyId }) {
  const rows = await withCompany(companyId, (conn) => repo.listMenus(conn, { companyId }));
  return { rows: camelRows(rows) };
}

export async function getMenuWithItems({ companyId, code, isActive }) {
  const result = await withCompany(companyId, async (conn) => {
    const menu = await repo.findMenuByCode(conn, { companyId, code });
    if (!menu) return null;
    const items = await repo.listMenuItems(conn, { companyId, menuId: menu.ID, isActive });
    return { menu, items };
  });

  if (!result) {
    throw new AppError(404, 'MENU_NOT_FOUND', 'Menu not found.');
  }

  return {
    menu: camelRow(result.menu),
    items: buildTree(camelRows(result.items), {
      sortBy: (a, b) => a.position - b.position || a.id - b.id,
    }),
  };
}

export async function patchMenu({ companyId, id, name }) {
  const updated = await withCompany(companyId, async (conn) => {
    const wasUpdated = await repo.updateMenu(conn, { companyId, id, name });
    if (wasUpdated) await conn.commit();
    return wasUpdated;
  });
  if (!updated) {
    throw new AppError(404, 'MENU_NOT_FOUND', 'Menu not found.');
  }
  const row = await withCompany(companyId, (conn) => repo.findMenuById(conn, { companyId, id }));
  return camelRow(row);
}

/* ---------------------------------------------------------------- menu items */

async function assertMenuExists(conn, { companyId, menuId }) {
  const menu = await repo.findMenuById(conn, { companyId, id: menuId });
  if (!menu) {
    throw new AppError(404, 'MENU_NOT_FOUND', 'Menu not found.');
  }
  return menu;
}

/** Same acyclic rule as categories, over the same helper. */
async function assertItemPlacementIsAcyclic(conn, { companyId, menuId, changes }) {
  const pairs = await repo.listMenuItemParentPairs(conn, { companyId, menuId });
  const parentById = new Map(pairs.map((row) => [row.ID, row.PARENT_ID]));

  for (const change of changes) {
    if (change.id !== undefined && !parentById.has(change.id)) {
      throw new AppError(404, 'MENU_ITEM_NOT_FOUND', `Menu item ${change.id} not found.`);
    }
    if (change.parentId === undefined) continue;
    if (change.parentId !== null && !parentById.has(change.parentId)) {
      throw new AppError(400, 'PARENT_NOT_FOUND', 'That parent menu item is not in this menu.');
    }
    if (change.parentId === change.id) {
      throw new AppError(400, 'CIRCULAR_PARENT', 'A menu item cannot be its own parent.');
    }
    if (change.id !== undefined) parentById.set(change.id, change.parentId);
  }

  const cycle = findCycle(parentById);
  if (cycle !== null) {
    throw new AppError(400, 'CIRCULAR_PARENT', `Menu item ${cycle} would end up inside itself.`);
  }

  return parentById;
}

export async function listMenuItems({ companyId, menuId, isActive }) {
  const rows = await withCompany(companyId, async (conn) => {
    await assertMenuExists(conn, { companyId, menuId });
    return repo.listMenuItems(conn, { companyId, menuId, isActive });
  });
  return {
    items: buildTree(camelRows(rows), { sortBy: (a, b) => a.position - b.position || a.id - b.id }),
  };
}

export async function addMenuItem({ companyId, menuId, ...input }) {
  await withCompany(companyId, async (conn) => {
    await assertMenuExists(conn, { companyId, menuId });
    if (input.parentId != null) {
      await assertItemPlacementIsAcyclic(conn, {
        companyId,
        menuId,
        changes: [{ parentId: undefined, id: input.parentId }],
      });
    }

    const siblings = await repo.listMenuItems(conn, { companyId, menuId });
    await repo.insertMenuItem(conn, {
      companyId,
      menuId,
      parentId: input.parentId ?? null,
      label: input.label,
      url: input.linkType === 'url' ? input.url : null,
      linkType: input.linkType,
      linkId: input.linkType === 'url' ? null : input.linkId,
      position: input.position ?? siblings.length,
      isActive: input.isActive ?? 1,
    });
    await conn.commit();
  });

  return listMenuItems({ companyId, menuId });
}

export async function patchMenuItem({ companyId, id, ...input }) {
  const menuId = await withCompany(companyId, async (conn) => {
    const existing = await repo.findMenuItemById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.');
    }

    if (input.parentId !== undefined) {
      await assertItemPlacementIsAcyclic(conn, {
        companyId,
        menuId: existing.MENU_ID,
        changes: [{ id, parentId: input.parentId ?? null }],
      });
    }

    const linkType = input.linkType ?? existing.LINK_TYPE;
    const url = input.url !== undefined ? input.url : existing.URL;
    const linkId = input.linkId !== undefined ? input.linkId : existing.LINK_ID;

    if (linkType === 'url' ? !url : !linkId) {
      throw new AppError(
        400,
        'INVALID_LINK',
        'A url link needs a url; every other link type needs something to point at.',
      );
    }

    await repo.updateMenuItem(conn, {
      id,
      companyId,
      parentId: input.parentId !== undefined ? (input.parentId ?? null) : existing.PARENT_ID,
      label: input.label ?? existing.LABEL,
      url: linkType === 'url' ? url : null,
      linkType,
      linkId: linkType === 'url' ? null : linkId,
      position: input.position ?? existing.POSITION,
      isActive: input.isActive ?? existing.IS_ACTIVE,
    });
    await conn.commit();
    return existing.MENU_ID;
  });

  return listMenuItems({ companyId, menuId });
}

export async function deleteMenuItem({ companyId, id }) {
  const menuId = await withCompany(companyId, async (conn) => {
    const existing = await repo.findMenuItemById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'MENU_ITEM_NOT_FOUND', 'Menu item not found.');
    }

    const children = await repo.countMenuItemChildren(conn, { companyId, id });
    if (children > 0) {
      throw new AppError(
        409,
        'MENU_ITEM_HAS_CHILDREN',
        `Move or delete this item's ${children} sub-item${children === 1 ? '' : 's'} first.`,
      );
    }

    await repo.deleteMenuItemById(conn, { companyId, id });
    await conn.commit();
    return existing.MENU_ID;
  });

  return listMenuItems({ companyId, menuId });
}

export async function reorderMenuItems({ companyId, menuId, items }) {
  await withCompany(companyId, async (conn) => {
    await assertMenuExists(conn, { companyId, menuId });

    const parentById = await assertItemPlacementIsAcyclic(conn, {
      companyId,
      menuId,
      changes: items.map((item) => ({
        id: item.id,
        parentId: item.parentId === undefined ? undefined : (item.parentId ?? null),
      })),
    });

    for (const item of items) {
      const existing = await repo.findMenuItemById(conn, { companyId, id: item.id });
      await repo.updateMenuItem(conn, {
        id: item.id,
        companyId,
        parentId: parentById.get(item.id) ?? null,
        label: existing.LABEL,
        url: existing.URL,
        linkType: existing.LINK_TYPE,
        linkId: existing.LINK_ID,
        position: item.position,
        isActive: existing.IS_ACTIVE,
      });
    }
    await conn.commit();
  });

  return listMenuItems({ companyId, menuId });
}
