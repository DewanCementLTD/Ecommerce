import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { slugify, resolveSlug } from '../../lib/slug.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import { parseJson, stringifyJson } from '../../lib/json.js';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/dbErrors.js';
import { insertLog } from '../logs/logs.repo.js';
import * as repo from './products.repo.js';

/* ------------------------------------------------------------- translation */

function rethrowAsBadReference(err) {
  if (isForeignKeyViolation(err, 'prod_cats_cat_fk')) {
    throw new AppError(400, 'CAT_NOT_FOUND', 'One of those categories does not exist in this store.');
  }
  if (isForeignKeyViolation(err, 'prod_imgs_media_fk')) {
    throw new AppError(400, 'IMAGE_NOT_FOUND', 'That image does not exist in this store.');
  }
  if (isUniqueViolation(err, 'variants_company_sku_uq')) {
    throw new AppError(409, 'SKU_TAKEN', 'Another variant in this store already uses that SKU.');
  }
  if (isUniqueViolation(err, 'prod_imgs_uq')) {
    throw new AppError(409, 'IMAGE_ALREADY_ATTACHED', 'That image is already on this product.');
  }
  throw err;
}

function toProductDto(row) {
  const product = camelRow(row);
  if (!product) return null;
  product.tags = parseJson(product.tags, []);
  return product;
}

function toVariantDto(row) {
  const variant = camelRow(row);
  if (!variant) return null;
  variant.opts = parseJson(variant.opts, {});
  return variant;
}

function toOptionDto(row) {
  const option = camelRow(row);
  if (!option) return null;
  option.vals = parseJson(option.vals, []);
  return option;
}

/* -------------------------------------------------------------- invariants */

/**
 * A variant's `opts` must name options the product actually declares, with
 * values those options actually offer. Oracle cannot express this (opts is JSON
 * on one table, the allowed values are rows on another), so it is enforced here
 * and covered by tests — see docs/DECISIONS.md on the options/opts redundancy.
 */
function assertOptsMatchOptions(opts, options) {
  const entries = Object.entries(opts ?? {});
  if (entries.length === 0) return;

  if (options.length === 0) {
    throw new AppError(
      400,
      'OPTIONS_NOT_DEFINED',
      'Define this product\'s options before giving its variants option values.',
    );
  }

  const allowed = new Map(options.map((option) => [option.name, new Set(option.vals)]));
  for (const [key, value] of entries) {
    const values = allowed.get(key);
    if (!values) {
      throw new AppError(400, 'UNKNOWN_VARIANT_OPTION', `This product has no option called "${key}".`);
    }
    if (!values.has(value)) {
      throw new AppError(
        400,
        'UNKNOWN_VARIANT_OPTION_VALUE',
        `"${value}" is not one of the values defined for "${key}".`,
      );
    }
  }
}

/**
 * Two variants of one product must not describe the same option combination.
 *
 * Variants with no option values are skipped rather than treated as identical:
 * a product can legitimately have several plain variants told apart by name or
 * SKU ("Pack of 6", "Pack of 12") without declaring options at all.
 */
function assertOptsAreUnique(variants) {
  const seen = new Set();
  for (const variant of variants) {
    const entries = Object.entries(variant.opts ?? {});
    if (entries.length === 0) continue;

    const key = JSON.stringify(
      entries.sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`),
    );
    if (seen.has(key)) {
      throw new AppError(
        400,
        'DUPLICATE_VARIANT_OPTIONS',
        'Two variants have the same combination of option values.',
      );
    }
    seen.add(key);
  }
}

async function loadOptionDtos(conn, { companyId, productId }) {
  const rows = await repo.listOptions(conn, { companyId, productId });
  return rows.map(toOptionDto);
}

async function nextFreeSlug(conn, { companyId, desired, fallbackFrom, excludeId }) {
  const base = desired ? slugify(desired) : slugify(fallbackFrom);
  const taken = await repo.findSlugsStartingWith(conn, { companyId, base, excludeId });
  return resolveSlug(base, taken);
}

async function replaceCats(conn, { companyId, productId, catIds }) {
  await repo.deleteProductCats(conn, { companyId, productId });
  for (const catId of new Set(catIds)) {
    await repo.insertProductCat(conn, { companyId, productId, catId });
  }
}

async function replaceOptions(conn, { companyId, productId, options }) {
  await repo.deleteOptionsByProduct(conn, { companyId, productId });
  await Promise.all(
    options.map((option, index) =>
      repo.insertOption(conn, {
        companyId,
        productId,
        name: option.name,
        vals: stringifyJson(option.vals),
        position: option.position ?? index,
      }),
    ),
  );
}

async function insertVariantRow(conn, { companyId, productId, variant, position, isDefault }) {
  return repo.insertVariant(conn, {
    companyId,
    productId,
    sku: variant.sku ?? null,
    barcode: variant.barcode ?? null,
    name: variant.name ?? null,
    opts: stringifyJson(variant.opts ?? null),
    price: variant.price ?? 0,
    salePrice: variant.salePrice ?? null,
    cost: variant.cost ?? null,
    stock: variant.stock ?? 0,
    weight: variant.weight ?? null,
    isDefault: isDefault ? 1 : 0,
    position: variant.position ?? position,
    isActive: variant.isActive ?? 1,
  });
}

/* ----------------------------------------------------------------- reading */

export async function listProducts({ companyId, ...query }) {
  const { rows, total } = await withCompany(companyId, (conn) =>
    repo.listProducts(conn, { companyId, ...query }),
  );

  return {
    rows: rows.map((row) => {
      const item = camelRow(row);
      item.tags = parseJson(item.tags, []);
      // The listing join already carries the default variant and primary image,
      // so the client never has to ask for them separately.
      return {
        id: item.id,
        name: item.name,
        slug: item.slug,
        shortDesc: item.shortDesc,
        brand: item.brand,
        isActive: item.isActive,
        isFeatured: item.isFeatured,
        tags: item.tags,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        defaultVariant: item.variantId
          ? {
              id: item.variantId,
              sku: item.sku,
              price: item.price,
              salePrice: item.salePrice,
              stock: item.stock,
            }
          : null,
        primaryImage: item.imageMediaId ? { mediaId: item.imageMediaId, alt: item.imageAlt } : null,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/**
 * The full aggregate for the product editor. Six statements for one product is
 * not an N+1 — none of them scale with the number of products on screen.
 */
export async function getProduct({ companyId, id }) {
  const result = await withCompany(companyId, async (conn) => {
    const product = await repo.findProductById(conn, { companyId, id });
    if (!product) return null;

    const [variants, options, images, catIds, collIds] = [
      await repo.listVariants(conn, { companyId, productId: id }),
      await repo.listOptions(conn, { companyId, productId: id }),
      await repo.listProductImages(conn, { companyId, productId: id }),
      await repo.listProductCatIds(conn, { companyId, productId: id }),
      await repo.listProductCollIds(conn, { companyId, productId: id }),
    ];

    return { product, variants, options, images, catIds, collIds };
  });

  if (!result) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }

  return {
    ...toProductDto(result.product),
    variants: result.variants.map(toVariantDto),
    options: result.options.map(toOptionDto),
    images: camelRows(result.images),
    catIds: result.catIds,
    collIds: result.collIds,
  };
}

/* ----------------------------------------------------------------- writing */

export async function createProduct({ companyId, actorAdminId, ip, ...input }) {
  const options = input.options ?? [];
  const variants = input.variants?.length
    ? input.variants
    : // "Every product has at least one variant" — a simple product is this one
      // default variant, and the storefront hides the picker when there is only one.
      [{ price: 0, stock: 0 }];

  for (const variant of variants) assertOptsMatchOptions(variant.opts, options);
  assertOptsAreUnique(variants);

  const defaultIndex = Math.max(
    variants.findIndex((variant) => variant.isDefault),
    0,
  );

  return withCompany(companyId, async (conn) => {
    try {
      const slug = await nextFreeSlug(conn, { companyId, desired: input.slug, fallbackFrom: input.name });

      const productId = await repo.insertProduct(conn, {
        companyId,
        name: input.name,
        slug,
        descr: input.descr ?? null,
        shortDesc: input.shortDesc ?? null,
        brand: input.brand ?? null,
        isActive: input.isActive ?? 1,
        isFeatured: input.isFeatured ?? 0,
        tags: stringifyJson(input.tags ?? []),
        metaTitle: input.metaTitle ?? null,
        metaDesc: input.metaDesc ?? null,
      });

      if (options.length) await replaceOptions(conn, { companyId, productId, options });
      if (input.catIds?.length) await replaceCats(conn, { companyId, productId, catIds: input.catIds });

      for (const [index, variant] of variants.entries()) {
        await insertVariantRow(conn, {
          companyId,
          productId,
          variant,
          position: index,
          isDefault: index === defaultIndex,
        });
      }

      await insertLog(conn, {
        companyId,
        adminId: actorAdminId,
        action: 'product_created',
        entity: 'product',
        entityId: productId,
        meta: { name: input.name, slug, variantCount: variants.length },
        ip,
      });

      await conn.commit();
      return productId;
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  }).then((productId) => getProduct({ companyId, id: productId }));
}

export async function patchProduct({ companyId, id, actorAdminId, ip, ...input }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findProductById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }

    try {
      const renaming = input.slug !== undefined || (input.name !== undefined && input.name !== existing.NAME);
      const slug = renaming
        ? await nextFreeSlug(conn, {
            companyId,
            desired: input.slug ?? input.name,
            fallbackFrom: input.name ?? existing.NAME,
            excludeId: id,
          })
        : existing.SLUG;

      await repo.updateProduct(conn, {
        id,
        companyId,
        name: input.name ?? existing.NAME,
        slug,
        descr: input.descr !== undefined ? input.descr : existing.DESCR,
        shortDesc: input.shortDesc !== undefined ? input.shortDesc : existing.SHORT_DESC,
        brand: input.brand !== undefined ? input.brand : existing.BRAND,
        isActive: input.isActive ?? existing.IS_ACTIVE,
        isFeatured: input.isFeatured ?? existing.IS_FEATURED,
        tags: input.tags !== undefined ? stringifyJson(input.tags ?? []) : existing.TAGS,
        metaTitle: input.metaTitle !== undefined ? input.metaTitle : existing.META_TITLE,
        metaDesc: input.metaDesc !== undefined ? input.metaDesc : existing.META_DESC,
      });

      if (input.options !== undefined) {
        // Changing the option set can strand existing variants, so re-check them.
        await replaceOptions(conn, { companyId, productId: id, options: input.options });
        const variants = await repo.listVariants(conn, { companyId, productId: id });
        for (const variant of variants) {
          assertOptsMatchOptions(parseJson(variant.OPTS, {}), input.options);
        }
      }

      if (input.catIds !== undefined) {
        await replaceCats(conn, { companyId, productId: id, catIds: input.catIds });
      }

      await insertLog(conn, {
        companyId,
        adminId: actorAdminId,
        action: 'product_updated',
        entity: 'product',
        entityId: id,
        meta: { fields: Object.keys(input) },
        ip,
      });

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getProduct({ companyId, id });
}

export async function deleteProduct({ companyId, id, actorAdminId, ip }) {
  const deleted = await withCompany(companyId, async (conn) => {
    const wasDeleted = await repo.softDeleteProduct(conn, { companyId, id });
    if (wasDeleted) {
      await insertLog(conn, {
        companyId,
        adminId: actorAdminId,
        action: 'product_deleted',
        entity: 'product',
        entityId: id,
        meta: {},
        ip,
      });
      await conn.commit();
    }
    return wasDeleted;
  });

  if (!deleted) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }
}

/**
 * Ids that belong to another company are filtered out by VPD rather than
 * rejected, so the response reports both numbers — the admin sees "12 of 15
 * updated" instead of a silent partial success.
 */
export async function bulkProducts({ companyId, ids, action, actorAdminId, ip }) {
  const affected = await withCompany(companyId, async (conn) => {
    const count =
      action === 'delete'
        ? await repo.bulkSoftDelete(conn, { companyId, ids })
        : await repo.bulkSetActive(conn, { companyId, ids, isActive: action === 'activate' ? 1 : 0 });

    await insertLog(conn, {
      companyId,
      adminId: actorAdminId,
      action: `product_bulk_${action}`,
      entity: 'product',
      entityId: null,
      meta: { requested: ids.length, affected: count },
      ip,
    });

    await conn.commit();
    return count;
  });

  return { requested: ids.length, affected };
}

export async function setProductCats({ companyId, id, catIds }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findProductById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
    }
    try {
      await replaceCats(conn, { companyId, productId: id, catIds });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getProduct({ companyId, id });
}

/* ---------------------------------------------------------------- variants */

async function assertProductExists(conn, { companyId, id }) {
  const product = await repo.findProductById(conn, { companyId, id });
  if (!product) {
    throw new AppError(404, 'PRODUCT_NOT_FOUND', 'Product not found.');
  }
  return product;
}

async function loadVariantOfProduct(conn, { companyId, productId, variantId }) {
  const variant = await repo.findVariantById(conn, { companyId, id: variantId });
  if (!variant || variant.PRODUCT_ID !== productId) {
    throw new AppError(404, 'VARIANT_NOT_FOUND', 'Variant not found on this product.');
  }
  return variant;
}

export async function listVariants({ companyId, productId }) {
  const rows = await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    return repo.listVariants(conn, { companyId, productId });
  });
  return { rows: rows.map(toVariantDto) };
}

export async function addVariant({ companyId, productId, ...input }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });

    const options = await loadOptionDtos(conn, { companyId, productId });
    assertOptsMatchOptions(input.opts, options);

    const siblings = (await repo.listVariants(conn, { companyId, productId })).map(toVariantDto);
    assertOptsAreUnique([...siblings, input]);

    try {
      if (input.isDefault) {
        await repo.clearDefaultVariant(conn, { companyId, productId });
      }
      await insertVariantRow(conn, {
        companyId,
        productId,
        variant: input,
        position: siblings.length,
        isDefault: input.isDefault ? 1 : 0,
      });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getProduct({ companyId, id: productId });
}

export async function patchVariant({ companyId, productId, variantId, ...input }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    const existing = await loadVariantOfProduct(conn, { companyId, productId, variantId });

    const opts = input.opts !== undefined ? (input.opts ?? {}) : parseJson(existing.OPTS, {});
    const options = await loadOptionDtos(conn, { companyId, productId });
    assertOptsMatchOptions(opts, options);

    const siblings = (await repo.listVariants(conn, { companyId, productId }))
      .map(toVariantDto)
      .filter((variant) => variant.id !== variantId);
    assertOptsAreUnique([...siblings, { opts }]);

    try {
      await repo.updateVariant(conn, {
        id: variantId,
        companyId,
        sku: input.sku !== undefined ? input.sku : existing.SKU,
        barcode: input.barcode !== undefined ? input.barcode : existing.BARCODE,
        name: input.name !== undefined ? input.name : existing.NAME,
        opts: stringifyJson(Object.keys(opts).length ? opts : null),
        price: input.price ?? existing.PRICE,
        salePrice: input.salePrice !== undefined ? input.salePrice : existing.SALE_PRICE,
        cost: input.cost !== undefined ? input.cost : existing.COST,
        stock: input.stock ?? existing.STOCK,
        weight: input.weight !== undefined ? input.weight : existing.WEIGHT,
        position: input.position ?? existing.POSITION,
        isActive: input.isActive ?? existing.IS_ACTIVE,
      });

      // Clear before set: the unique index allows only one default per product.
      if (input.isDefault === 1 && existing.IS_DEFAULT !== 1) {
        await repo.clearDefaultVariant(conn, { companyId, productId });
        await repo.markVariantDefault(conn, { companyId, id: variantId });
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getProduct({ companyId, id: productId });
}

export async function deleteVariant({ companyId, productId, variantId }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    const existing = await loadVariantOfProduct(conn, { companyId, productId, variantId });

    const remaining = await repo.countVariants(conn, { companyId, productId });
    if (remaining <= 1) {
      throw new AppError(
        409,
        'LAST_VARIANT',
        'A product must keep at least one variant. Delete the product instead.',
      );
    }

    await repo.deleteVariantById(conn, { companyId, id: variantId });

    // Something must remain the default, or the product has no price to show.
    if (existing.IS_DEFAULT === 1) {
      const survivors = await repo.listVariants(conn, { companyId, productId });
      if (survivors.length) {
        await repo.markVariantDefault(conn, { companyId, id: survivors[0].ID });
      }
    }

    await conn.commit();
  });

  return getProduct({ companyId, id: productId });
}

export async function adjustStock({ companyId, productId, variantId, delta, set, reason, actorAdminId, ip }) {
  const result = await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    const existing = await loadVariantOfProduct(conn, { companyId, productId, variantId });

    const from = existing.STOCK;
    const to = set !== undefined ? set : from + delta;
    if (to < 0) {
      throw new AppError(
        400,
        'STOCK_NEGATIVE',
        `That would take stock to ${to}. Stock cannot go below zero.`,
      );
    }

    await repo.setVariantStock(conn, { companyId, id: variantId, stock: to });
    await insertLog(conn, {
      companyId,
      adminId: actorAdminId,
      action: 'stock_adjusted',
      entity: 'variant',
      entityId: variantId,
      meta: { productId, from, to, delta: to - from, reason: reason ?? null },
      ip,
    });
    await conn.commit();

    return { variantId, from, to, delta: to - from };
  });

  return result;
}

/* ------------------------------------------------------------------ options */

export async function setOptions({ companyId, productId, options }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    await replaceOptions(conn, { companyId, productId, options });

    const variants = await repo.listVariants(conn, { companyId, productId });
    for (const variant of variants) {
      assertOptsMatchOptions(parseJson(variant.OPTS, {}), options);
    }

    await conn.commit();
  });

  return getProduct({ companyId, id: productId });
}

/* ------------------------------------------------------------------- images */

export async function listImages({ companyId, productId }) {
  const rows = await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    return repo.listProductImages(conn, { companyId, productId });
  });
  return { rows: camelRows(rows) };
}

export async function addImage({ companyId, productId, mediaId, alt }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    try {
      const position = await repo.nextImagePosition(conn, { companyId, productId });
      await repo.insertProductImage(conn, { companyId, productId, mediaId, alt: alt ?? null, position });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return listImages({ companyId, productId });
}

export async function patchImage({ companyId, productId, imageId, alt }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    const existing = await repo.findProductImageById(conn, { companyId, productId, id: imageId });
    if (!existing) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found on this product.');
    }
    await repo.updateProductImage(conn, { companyId, id: imageId, alt: alt ?? null });
    await conn.commit();
  });

  return listImages({ companyId, productId });
}

export async function deleteImage({ companyId, productId, imageId }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });
    const existing = await repo.findProductImageById(conn, { companyId, productId, id: imageId });
    if (!existing) {
      throw new AppError(404, 'IMAGE_NOT_FOUND', 'Image not found on this product.');
    }
    // Detaches the image from the product; the media row itself is untouched and
    // stays in the library.
    await repo.deleteProductImageById(conn, { companyId, id: imageId });
    await conn.commit();
  });

  return listImages({ companyId, productId });
}

/** Whole reorder in one transaction, so the gallery never lands half-sorted. */
export async function reorderImages({ companyId, productId, items }) {
  await withCompany(companyId, async (conn) => {
    await assertProductExists(conn, { companyId, id: productId });

    const owned = new Set(
      (await repo.listProductImages(conn, { companyId, productId })).map((row) => row.ID),
    );
    for (const item of items) {
      if (!owned.has(item.id)) {
        throw new AppError(404, 'IMAGE_NOT_FOUND', `Image ${item.id} is not on this product.`);
      }
    }

    for (const item of items) {
      await repo.updateProductImagePosition(conn, {
        companyId,
        productId,
        id: item.id,
        position: item.position,
      });
    }

    await conn.commit();
  });

  return listImages({ companyId, productId });
}
