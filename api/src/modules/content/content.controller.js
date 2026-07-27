import { SECTIONS } from '@storeforge/shared';
import {
  idParamSchema,
  pageCreateSchema,
  pagePatchSchema,
  pageListQuerySchema,
  sectionCreateSchema,
  sectionPatchSchema,
  sectionReorderSchema,
  bannerCreateSchema,
  bannerPatchSchema,
  bannerListQuerySchema,
  menuPatchSchema,
  menuItemCreateSchema,
  menuItemPatchSchema,
  menuItemReorderSchema,
} from './content.schema.js';
import * as contentService from './content.service.js';

const companyOf = (req) => req.admin.companyId;

/* -------------------------------------------------------------------- pages */

export async function postPage(req, res, next) {
  try {
    const body = pageCreateSchema.parse(req.body);
    res.status(201).json({ page: await contentService.createPage({ companyId: companyOf(req), ...body }) });
  } catch (err) {
    next(err);
  }
}

export async function getPages(req, res, next) {
  try {
    const query = pageListQuerySchema.parse(req.query);
    res.json(await contentService.listPages({ companyId: companyOf(req), ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getPage(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json({ page: await contentService.getPage({ companyId: companyOf(req), id }) });
  } catch (err) {
    next(err);
  }
}

export async function patchPage(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = pagePatchSchema.parse(req.body);
    res.json({ page: await contentService.patchPage({ companyId: companyOf(req), id, ...body }) });
  } catch (err) {
    next(err);
  }
}

export async function deletePage(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await contentService.deletePage({ companyId: companyOf(req), id }));
  } catch (err) {
    next(err);
  }
}

/* ----------------------------------------------------------------- sections */

/** The registry itself, so the admin builds its forms from the same source. */
export function getSectionRegistry(req, res) {
  res.json({ sections: SECTIONS });
}

export async function getSections(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await contentService.listSections({ companyId: companyOf(req), pageId: id }));
  } catch (err) {
    next(err);
  }
}

export async function postSection(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = sectionCreateSchema.parse(req.body);
    res.status(201).json(await contentService.addSection({ companyId: companyOf(req), pageId: id, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function patchSection(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = sectionPatchSchema.parse(req.body);
    res.json(await contentService.patchSection({ companyId: companyOf(req), id, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function deleteSection(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await contentService.deleteSection({ companyId: companyOf(req), id }));
  } catch (err) {
    next(err);
  }
}

export async function postSectionReorder(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { items } = sectionReorderSchema.parse(req.body);
    res.json(await contentService.reorderSections({ companyId: companyOf(req), pageId: id, items }));
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ banners */

export async function postBanner(req, res, next) {
  try {
    const body = bannerCreateSchema.parse(req.body);
    res.status(201).json({ banner: await contentService.createBanner({ companyId: companyOf(req), ...body }) });
  } catch (err) {
    next(err);
  }
}

export async function getBanners(req, res, next) {
  try {
    const query = bannerListQuerySchema.parse(req.query);
    res.json(await contentService.listBanners({ companyId: companyOf(req), ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getBanner(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json({ banner: await contentService.getBanner({ companyId: companyOf(req), id }) });
  } catch (err) {
    next(err);
  }
}

export async function patchBanner(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = bannerPatchSchema.parse(req.body);
    res.json({ banner: await contentService.patchBanner({ companyId: companyOf(req), id, ...body }) });
  } catch (err) {
    next(err);
  }
}

export async function deleteBanner(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    await contentService.deleteBanner({ companyId: companyOf(req), id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

/* -------------------------------------------------------------------- menus */

export async function getMenus(req, res, next) {
  try {
    res.json(await contentService.listMenus({ companyId: companyOf(req) }));
  } catch (err) {
    next(err);
  }
}

export async function patchMenu(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { name } = menuPatchSchema.parse(req.body);
    res.json({ menu: await contentService.patchMenu({ companyId: companyOf(req), id, name }) });
  } catch (err) {
    next(err);
  }
}

export async function getMenuItems(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await contentService.listMenuItems({ companyId: companyOf(req), menuId: id }));
  } catch (err) {
    next(err);
  }
}

export async function postMenuItem(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = menuItemCreateSchema.parse(req.body);
    res.status(201).json(await contentService.addMenuItem({ companyId: companyOf(req), menuId: id, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function patchMenuItem(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = menuItemPatchSchema.parse(req.body);
    res.json(await contentService.patchMenuItem({ companyId: companyOf(req), id, ...body }));
  } catch (err) {
    next(err);
  }
}

export async function deleteMenuItem(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(await contentService.deleteMenuItem({ companyId: companyOf(req), id }));
  } catch (err) {
    next(err);
  }
}

export async function postMenuItemReorder(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { items } = menuItemReorderSchema.parse(req.body);
    res.json(await contentService.reorderMenuItems({ companyId: companyOf(req), menuId: id, items }));
  } catch (err) {
    next(err);
  }
}
