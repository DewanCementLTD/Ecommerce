import * as catsService from '../cats/cats.service.js';
import * as productsService from '../products/products.service.js';
import * as collsService from '../colls/colls.service.js';
import * as i18nService from '../i18n/i18n.service.js';
import { loadTranslations, applyTranslations } from '../i18n/i18n.service.js';
import * as contentService from '../content/content.service.js';
import { resolveSections } from './shop.sections.js';
import { imageUrl, toCard, toDetail, toPublicCat, toPublicTreeNode } from './shop.dto.js';

/**
 * The public face of the catalog.
 *
 * This module owns no SQL. It composes the catalog services and then decides
 * what a shopper is allowed to see — one place to answer that question, rather
 * than a public projection scattered through three modules. Anything not listed
 * in a mapper here does not reach the storefront: `cost`, `deleted_at`,
 * inactive rows, and internal audit fields all stop at this boundary.
 *
 * The company is always `req.companyId` from the resolved host, never anything
 * the client sent.
 */

/**
 * Translation is applied here rather than inside each catalog service, for the
 * same reason the public projection is: the storefront is the only caller that
 * reads in a shopper's language, and the admin must keep seeing the rows as
 * stored. `lang` and `defaultLang` both come from the resolved company.
 *
 * Every call is batched — one query per entity type per request, never one per
 * row — and falls back per field, so a half-translated product shows its
 * translated name beside its untranslated description.
 */
async function translate({ companyId, entity, rows, lang, defaultLang, idKey = 'id' }) {
  if (!lang || lang === defaultLang || rows.length === 0) return rows;
  const map = await loadTranslations({
    companyId,
    entity,
    entityIds: rows.map((row) => row[idKey]),
    lang,
    defaultLang,
  });
  return applyTranslations(rows, map, { idKey });
}

/** Nested categories, translated level by level in one query for the whole tree. */
async function translateTree({ companyId, nodes, lang, defaultLang }) {
  if (!lang || lang === defaultLang) return nodes;

  const flat = [];
  const walk = (list) => list.forEach((node) => { flat.push(node); walk(node.children); });
  walk(nodes);
  if (flat.length === 0) return nodes;

  const map = await loadTranslations({
    companyId,
    entity: 'cat',
    entityIds: flat.map((node) => node.id),
    lang,
    defaultLang,
  });
  if (map.size === 0) return nodes;

  const rebuild = (list) =>
    list.map((node) => ({ ...node, ...(map.get(node.id) ?? {}), children: rebuild(node.children) }));
  return rebuild(nodes);
}

export async function listProducts({ companyId, page, pageSize, search, catId, collId, sort, dir, featured, lang, defaultLang }) {
  const result = await productsService.listProducts({
    companyId,
    page,
    pageSize,
    search,
    catId,
    collId,
    isActive: 1,
    isFeatured: featured ? 1 : undefined,
    sort,
    dir,
  });

  const translated = await translate({
    companyId,
    entity: 'product',
    rows: result.rows,
    lang,
    defaultLang,
  });

  return {
    rows: translated.map(toCard),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  };
}

export async function getProduct({ companyId, slug, lang, defaultLang }) {
  const product = await productsService.getProductBySlug({ companyId, slug, activeOnly: true });
  const [translated] = await translate({
    companyId,
    entity: 'product',
    rows: [product],
    lang,
    defaultLang,
  });
  return toDetail(translated);
}

export async function getCatTree({ companyId, lang, defaultLang }) {
  const { tree } = await catsService.getCatTree({ companyId, isActive: 1 });
  const translated = await translateTree({ companyId, nodes: tree, lang, defaultLang });
  return { tree: translated.map(toPublicTreeNode) };
}

export async function getCatWithProducts({ companyId, slug, page, pageSize, sort, dir, lang, defaultLang }) {
  const cat = await catsService.getCatBySlug({ companyId, slug, activeOnly: true });
  const [translatedCat] = await translate({ companyId, entity: 'cat', rows: [cat], lang, defaultLang });
  const products = await listProducts({
    companyId,
    page,
    pageSize,
    catId: cat.id,
    sort,
    dir,
    lang,
    defaultLang,
  });
  return { cat: toPublicCat(translatedCat), products };
}

export async function getCollWithProducts({ companyId, slug, page, pageSize, lang, defaultLang }) {
  const coll = await collsService.getCollBySlug({ companyId, slug, activeOnly: true });
  const [translatedColl] = await translate({ companyId, entity: 'coll', rows: [coll], lang, defaultLang });

  const members = await collsService.listCollProducts({
    companyId,
    id: coll.id,
    page,
    pageSize,
    activeOnly: true,
  });
  const translatedRows = await translate({
    companyId,
    entity: 'product',
    rows: members.rows,
    lang,
    defaultLang,
  });

  return {
    coll: {
      id: translatedColl.id,
      name: translatedColl.name,
      slug: translatedColl.slug,
      descr: translatedColl.descr,
      image: coll.imageId ? { mediaId: coll.imageId, alt: translatedColl.name, url: imageUrl(coll.imageId) } : null,
    },
    products: {
      rows: translatedRows.map(toCard),
      total: members.total,
      page: members.page,
      pageSize: members.pageSize,
    },
  };
}

/** Drives the storefront's language switcher and its hreflang alternates. */
export async function listLangs({ companyId }) {
  const { rows } = await i18nService.listLangs({ companyId });
  return {
    langs: rows
      .filter((row) => row.isActive === 1)
      .map((row) => ({ code: row.code, name: row.name, isDefault: row.isDefault === 1 })),
  };
}

export async function search({ companyId, q, page, pageSize, lang, defaultLang }) {
  const result = await listProducts({
    companyId,
    page,
    pageSize,
    search: q,
    sort: 'name',
    dir: 'asc',
    lang,
    defaultLang,
  });
  return { q, ...result };
}

/* ------------------------------------------------------------ pages & menus */

/**
 * Header and footer in one call, with each menu item's pointer resolved to the
 * slug it should link to. Storing a pointer rather than a URL means renaming a
 * category cannot break the navigation; resolving it here means the storefront
 * does not have to know how.
 */
export async function getMenus({ companyId, lang, defaultLang }) {
  const menus = {};

  for (const code of ['header', 'footer']) {
    let menu;
    try {
      menu = await contentService.getMenuWithItems({ companyId, code, isActive: 1 });
    } catch {
      menus[code] = null;
      continue;
    }

    const flat = [];
    const walk = (items) => items.forEach((item) => { flat.push(item); walk(item.children); });
    walk(menu.items);

    const translations = await loadTranslations({
      companyId,
      entity: 'menu_item',
      entityIds: flat.map((item) => item.id),
      lang,
      defaultLang,
    });

    const targets = await resolveMenuTargets({ companyId, items: flat });

    const shape = (items) =>
      items.map((item) => ({
        id: item.id,
        label: translations.get(item.id)?.label ?? item.label,
        linkType: item.linkType,
        url: item.url,
        targetSlug: targets.get(`${item.linkType}:${item.linkId}`) ?? null,
        children: shape(item.children),
      }));

    menus[code] = { code, items: shape(menu.items) };
  }

  return { menus };
}

/** One lookup per referenced entity type, not one per menu item. */
async function resolveMenuTargets({ companyId, items }) {
  const targets = new Map();
  const byType = { cat: [], coll: [], page: [], product: [] };

  for (const item of items) {
    if (item.linkType !== 'url' && item.linkId) byType[item.linkType]?.push(item.linkId);
  }

  if (byType.cat.length) {
    const { rows } = await catsService.listCats({ companyId, isActive: 1 });
    for (const row of rows) targets.set(`cat:${row.id}`, row.slug);
  }
  if (byType.coll.length) {
    const { rows } = await collsService.listColls({ companyId, page: 1, pageSize: 100, isActive: 1 });
    for (const row of rows) targets.set(`coll:${row.id}`, row.slug);
  }
  if (byType.page.length) {
    const { rows } = await contentService.listPages({ companyId, isActive: 1 });
    for (const row of rows) targets.set(`page:${row.id}`, row.slug);
  }
  for (const productId of byType.product) {
    try {
      const product = await productsService.getProduct({ companyId, id: productId });
      targets.set(`product:${productId}`, product.slug);
    } catch {
      // Linked product was deleted; the item falls back to its id and 404s
      // rather than breaking the whole navigation.
    }
  }

  return targets;
}

async function loadPageWithSections({ companyId, page, lang, defaultLang }) {
  const { rows } = await contentService.listSections({ companyId, pageId: page.id, isActive: 1 });

  const translated = await translate({
    companyId,
    entity: 'section',
    rows: rows.map((row) => ({ ...row, ...row.settings })),
    lang,
    defaultLang,
  });

  const withTranslatedSettings = rows.map((row, index) => ({
    ...row,
    settings: { ...row.settings, ...pickTranslatable(translated[index], row.settings) },
  }));

  const [pageTranslated] = await translate({
    companyId,
    entity: 'page',
    rows: [page],
    lang,
    defaultLang,
  });

  const sections = await resolveSections({ companyId, sections: withTranslatedSettings });

  return {
    page: {
      id: pageTranslated.id,
      title: pageTranslated.title,
      slug: pageTranslated.slug,
      type: pageTranslated.type,
      content: pageTranslated.content,
      metaTitle: pageTranslated.metaTitle,
      metaDesc: pageTranslated.metaDesc,
      ogImage: pageTranslated.ogImageId ? imageUrl(pageTranslated.ogImageId) : null,
    },
    sections: await translateSectionData({ companyId, sections, lang, defaultLang }),
  };
}

/**
 * Translates the rows a section resolved — the products in a row, the
 * categories in a tile grid.
 *
 * Done once across every section rather than per section: a home page with
 * three product rows issues one translation query for all of them, not three.
 * Without this the chrome and headings translate while the content underneath
 * stays in the default language, which is worse than no translation at all.
 */
async function translateSectionData({ companyId, sections, lang, defaultLang }) {
  if (!lang || lang === defaultLang) return sections;

  const productIds = new Set();
  const catIds = new Set();
  for (const section of sections) {
    for (const product of section.data.products ?? []) productIds.add(product.id);
    for (const cat of section.data.cats ?? []) catIds.add(cat.id);
  }
  if (productIds.size === 0 && catIds.size === 0) return sections;

  const [products, cats] = await Promise.all([
    loadTranslations({ companyId, entity: 'product', entityIds: [...productIds], lang, defaultLang }),
    loadTranslations({ companyId, entity: 'cat', entityIds: [...catIds], lang, defaultLang }),
  ]);

  return sections.map((section) => ({
    ...section,
    data: {
      ...section.data,
      ...(section.data.products
        ? { products: section.data.products.map((row) => ({ ...row, ...(products.get(row.id) ?? {}) })) }
        : {}),
      ...(section.data.cats
        ? { cats: section.data.cats.map((row) => ({ ...row, ...(cats.get(row.id) ?? {}) })) }
        : {}),
    },
  }));
}

/** Only the keys the section actually has — a translation cannot add settings. */
function pickTranslatable(translatedRow, settings) {
  const picked = {};
  for (const key of Object.keys(settings)) {
    if (translatedRow?.[key] !== undefined && typeof translatedRow[key] === 'string') {
      picked[key] = translatedRow[key];
    }
  }
  return picked;
}

export async function getHome({ companyId, lang, defaultLang }) {
  const { rows } = await contentService.listPages({ companyId, isActive: 1 });
  const home = rows.find((row) => row.type === 'home');
  if (!home) {
    // A store with no home page still has to render something rather than 500.
    return { page: null, sections: [] };
  }
  return loadPageWithSections({ companyId, page: home, lang, defaultLang });
}

/* ----------------------------------------------------------------- sitemap */

/**
 * Every indexable path this store has, in one call.
 *
 * The storefront cannot assemble this from the paged catalog endpoints without
 * walking them page by page over HTTP, so the walking happens here, on the
 * database side of the boundary, and the storefront gets a flat list. Language
 * variants are not listed as separate entries: `sitemap.js` expands each path
 * into its `hreflang` alternates, because a translated product is the same URL
 * in another language, not another URL.
 *
 * Deliberately unlocalized and uncapped-per-type but bounded overall: a store
 * with more products than SITEMAP_MAX_URLS needs a sitemap index, which is a
 * different feature and not one any store here is close to needing.
 */
const SITEMAP_MAX_URLS = 5000;
const SITEMAP_PAGE_SIZE = 500;

export async function getSitemap({ companyId }) {
  const urls = [{ path: '/', changeFrequency: 'daily', priority: 1 }];

  const [{ rows: cats }, { rows: colls }, { rows: pages }] = await Promise.all([
    catsService.listCats({ companyId, isActive: 1 }),
    collsService.listColls({ companyId, page: 1, pageSize: 200, isActive: 1 }),
    contentService.listPages({ companyId, isActive: 1 }),
  ]);

  for (const cat of cats) {
    urls.push({
      path: `/cats/${cat.slug}`,
      lastModified: cat.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  for (const coll of colls) {
    urls.push({
      path: `/colls/${coll.slug}`,
      lastModified: coll.updatedAt,
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  for (const page of pages) {
    // The home page is already in as '/', and it is the only page whose slug
    // is not part of its URL.
    if (page.type === 'home') continue;
    urls.push({
      path: `/pages/${page.slug}`,
      lastModified: page.updatedAt,
      changeFrequency: 'monthly',
      priority: 0.4,
    });
  }

  for (let page = 1; urls.length < SITEMAP_MAX_URLS; page += 1) {
    const result = await productsService.listProducts({
      companyId,
      page,
      pageSize: SITEMAP_PAGE_SIZE,
      isActive: 1,
      sort: 'created',
      dir: 'desc',
    });

    for (const product of result.rows) {
      urls.push({
        path: `/products/${product.slug}`,
        lastModified: product.updatedAt,
        changeFrequency: 'weekly',
        priority: 0.7,
      });
    }

    if (result.rows.length < SITEMAP_PAGE_SIZE) break;
  }

  return { urls: urls.slice(0, SITEMAP_MAX_URLS) };
}

export async function getPage({ companyId, slug, lang, defaultLang }) {
  const { rows } = await contentService.listPages({ companyId, isActive: 1 });
  const page = rows.find((row) => row.slug === slug);
  if (!page) {
    const { AppError } = await import('../../middleware/error.js');
    throw new AppError(404, 'PAGE_NOT_FOUND', 'Page not found.');
  }
  return loadPageWithSections({ companyId, page, lang, defaultLang });
}
