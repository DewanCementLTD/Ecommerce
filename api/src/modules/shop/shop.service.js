import * as catsService from '../cats/cats.service.js';
import * as productsService from '../products/products.service.js';
import * as collsService from '../colls/colls.service.js';

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

export async function listProducts({ companyId, page, pageSize, search, catId, collId, sort, dir, featured }) {
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

  return { rows: result.rows.map(toCard), total: result.total, page: result.page, pageSize: result.pageSize };
}

export async function getProduct({ companyId, slug }) {
  const product = await productsService.getProductBySlug({ companyId, slug, activeOnly: true });
  return toDetail(product);
}

export async function getCatTree({ companyId }) {
  const { tree } = await catsService.getCatTree({ companyId, isActive: 1 });
  return { tree: tree.map(toPublicTreeNode) };
}

export async function getCatWithProducts({ companyId, slug, page, pageSize, sort, dir }) {
  const cat = await catsService.getCatBySlug({ companyId, slug, activeOnly: true });
  const products = await listProducts({ companyId, page, pageSize, catId: cat.id, sort, dir });
  return { cat: toPublicCat(cat), products };
}

export async function getCollWithProducts({ companyId, slug, page, pageSize }) {
  const coll = await collsService.getCollBySlug({ companyId, slug, activeOnly: true });
  const members = await collsService.listCollProducts({
    companyId,
    id: coll.id,
    page,
    pageSize,
    activeOnly: true,
  });

  return {
    coll: {
      id: coll.id,
      name: coll.name,
      slug: coll.slug,
      descr: coll.descr,
      image: coll.imageId ? { mediaId: coll.imageId, alt: coll.name, url: imageUrl(coll.imageId) } : null,
    },
    products: {
      rows: members.rows.map(toCard),
      total: members.total,
      page: members.page,
      pageSize: members.pageSize,
    },
  };
}

export async function search({ companyId, q, page, pageSize }) {
  const result = await listProducts({ companyId, page, pageSize, search: q, sort: 'name', dir: 'asc' });
  return { q, ...result };
}
