/**
 * The public shape of catalog rows.
 *
 * Extracted from shop.service.js because the section resolver needs the exact
 * same mapping: a product row inside a `prod_row` section must reach the
 * storefront looking identical to one in a category listing, or the card
 * component silently renders 0.00 and no image. One definition, both callers.
 *
 * This is also the boundary that strips `cost`, inactive rows and internal
 * fields — anything not named here does not reach a shopper.
 */

/** Public path for a media row, proxied to the API by the storefront. */
export function imageUrl(mediaId) {
  return mediaId ? `/storefront/media/${mediaId}/file` : null;
}

/** A product as it appears in a grid or a section row. */
export function toCard(product) {
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
      ? {
          mediaId: product.primaryImage.mediaId,
          alt: product.primaryImage.alt,
          url: imageUrl(product.primaryImage.mediaId),
        }
      : null,
  };
}

/** A product as it appears on its own page. */
export function toDetail(product) {
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

export function toPublicCat(cat) {
  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    descr: cat.descr ?? null,
    metaTitle: cat.metaTitle ?? null,
    metaDesc: cat.metaDesc ?? null,
    image: cat.imageId ? { mediaId: cat.imageId, alt: cat.name, url: imageUrl(cat.imageId) } : null,
  };
}

export function toPublicTreeNode(node) {
  return {
    id: node.id,
    name: node.name,
    slug: node.slug,
    image: node.imageId ? { mediaId: node.imageId, alt: node.name, url: imageUrl(node.imageId) } : null,
    children: node.children.map(toPublicTreeNode),
  };
}
