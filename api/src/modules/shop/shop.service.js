import * as catsService from '../cats/cats.service.js';
import * as productsService from '../products/products.service.js';
import * as collsService from '../colls/colls.service.js';
import * as i18nService from '../i18n/i18n.service.js';
import { loadTranslations, applyTranslations } from '../i18n/i18n.service.js';

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

/** Public URL for a media row, served by the existing storefront media route. */
function imageUrl(mediaId) {
  return mediaId ? `/storefront/media/${mediaId}/file` : null;
}

function toPublicImage(image) {
  return image ? { mediaId: image.mediaId, alt: image.alt, url: imageUrl(image.mediaId) } : null;
}

/** A product as it appears in a grid. */
function toCard(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDesc: product.shortDesc,
    brand: product.brand,
    isFeatured: product.isFeatured,
    tags: product.tags,
    price: product.defaultVariant?.price ?? null,
    salePrice: product.defaultVariant?.salePrice ?? null,
    inStock: (product.defaultVariant?.stock ?? 0) > 0,
    image: product.primaryImage
      ? { mediaId: product.primaryImage.mediaId, alt: product.primaryImage.alt, url: imageUrl(product.primaryImage.mediaId) }
      : null,
  };
}

/** A product as it appears on its own page. */
function toDetail(product) {
  const variants = product.variants
    .filter((variant) => variant.isActive === 1)
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      opts: variant.opts,
      price: variant.price,
      salePrice: variant.salePrice,
      inStock: variant.stock > 0,
      stock: variant.stock,
      isDefault: variant.isDefault,
    }));

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    descr: product.descr,
    shortDesc: product.shortDesc,
    brand: product.brand,
    tags: product.tags,
    metaTitle: product.metaTitle,
    metaDesc: product.metaDesc,
    options: product.options.map((option) => ({ name: option.name, vals: option.vals })),
    variants,
    // A single-variant product is a "simple" product — the storefront hides the
    // picker rather than branching onto a different code path.
    defaultVariant: variants.find((variant) => variant.isDefault === 1) ?? variants[0] ?? null,
    images: product.images.map((image) => ({
      mediaId: image.mediaId,
      alt: image.alt,
      url: imageUrl(image.mediaId),
    })),
  };
}

function toPublicCat(cat) {
  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    descr: cat.descr ?? null,
    metaTitle: cat.metaTitle ?? null,
    metaDesc: cat.metaDesc ?? null,
    image: toPublicImage(cat.imageId ? { mediaId: cat.imageId, alt: cat.name } : null),
  };
}

function toPublicTreeNode(node) {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    image: node.imageId ? { mediaId: node.imageId, alt: node.name, url: imageUrl(node.imageId) } : null,
    children: node.children.map(toPublicTreeNode),
  };
}

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
