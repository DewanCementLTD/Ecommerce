import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { slugify, resolveSlug } from '../../lib/slug.js';
import { camelRow } from '../../lib/rows.js';
import { parseJson, stringifyJson } from '../../lib/json.js';
import { isForeignKeyViolation } from '../../lib/dbErrors.js';
import * as repo from './colls.repo.js';

function rethrowAsBadReference(err) {
  if (isForeignKeyViolation(err, 'colls_image_fk')) {
    throw new AppError(400, 'IMAGE_NOT_FOUND', 'That image does not exist in this store.');
  }
  if (isForeignKeyViolation(err, 'coll_prods_product_fk')) {
    throw new AppError(400, 'PRODUCT_NOT_FOUND', 'One of those products does not exist in this store.');
  }
  throw err;
}

function toCollDto(row) {
  const coll = camelRow(row);
  if (!coll) return null;
  coll.rules = parseJson(coll.rules, null);
  return coll;
}

/** Shared by the listing and the collection-members endpoint. */
function toProductCard(row) {
  const item = camelRow(row);
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    shortDesc: item.shortDesc,
    brand: item.brand,
    isActive: item.isActive,
    isFeatured: item.isFeatured,
    tags: parseJson(item.tags, []),
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
}

async function nextFreeSlug(conn, { companyId, desired, fallbackFrom, excludeId }) {
  const base = desired ? slugify(desired) : slugify(fallbackFrom);
  const taken = await repo.findSlugsStartingWith(conn, { companyId, base, excludeId });
  return resolveSlug(base, taken);
}

async function replaceMembers(conn, { companyId, collId, productIds }) {
  const unique = [...new Set(productIds)];
  const owned = new Set(await repo.filterOwnedProductIds(conn, { companyId, productIds: unique }));
  const missing = unique.filter((productId) => !owned.has(productId));
  if (missing.length) {
    throw new AppError(
      400,
      'PRODUCT_NOT_FOUND',
      `${missing.length} of those products do not exist in this store.`,
    );
  }

  await repo.deleteCollProds(conn, { companyId, collId });
  for (const [index, productId] of unique.entries()) {
    await repo.insertCollProd(conn, { companyId, collId, productId, position: index });
  }
  return unique.length;
}

export async function createColl({ companyId, ...input }) {
  const type = input.type ?? 'manual';
  // Compiled here purely to reject a bad rule before anything is written.
  if (type === 'auto') repo.compileRules(input.rules);

  const collId = await withCompany(companyId, async (conn) => {
    try {
      const slug = await nextFreeSlug(conn, { companyId, desired: input.slug, fallbackFrom: input.name });
      const id = await repo.insertColl(conn, {
        companyId,
        name: input.name,
        slug,
        descr: input.descr ?? null,
        imageId: input.imageId ?? null,
        type,
        rules: type === 'auto' ? stringifyJson(input.rules) : null,
        isActive: input.isActive ?? 1,
      });

      if (type === 'manual' && input.productIds?.length) {
        await replaceMembers(conn, { companyId, collId: id, productIds: input.productIds });
      }

      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getColl({ companyId, id: collId });
}

export async function listColls({ companyId, ...query }) {
  const { rows, total } = await withCompany(companyId, (conn) =>
    repo.listColls(conn, { companyId, ...query }),
  );

  return {
    rows: rows.map((row) => {
      const coll = toCollDto(row);
      // Only meaningful for manual collections; an automatic one's size depends
      // on what currently matches, which is a query, not a stored number.
      coll.productCount = coll.type === 'manual' ? coll.manualCount : null;
      delete coll.manualCount;
      return coll;
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getColl({ companyId, id }) {
  const row = await withCompany(companyId, (conn) => repo.findCollById(conn, { companyId, id }));
  if (!row) {
    throw new AppError(404, 'COLL_NOT_FOUND', 'Collection not found.');
  }
  return toCollDto(row);
}

export async function patchColl({ companyId, id, ...input }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findCollById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'COLL_NOT_FOUND', 'Collection not found.');
    }

    const type = input.type ?? existing.TYPE;
    const rules = input.rules !== undefined ? input.rules : parseJson(existing.RULES, null);

    if (type === 'auto') {
      if (!rules?.conditions?.length) {
        throw new AppError(400, 'RULES_REQUIRED', 'An automatic collection needs at least one rule.');
      }
      repo.compileRules(rules);
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

      await repo.updateColl(conn, {
        id,
        companyId,
        name: input.name ?? existing.NAME,
        slug,
        descr: input.descr !== undefined ? input.descr : existing.DESCR,
        imageId: input.imageId !== undefined ? (input.imageId ?? null) : existing.IMAGE_ID,
        type,
        rules: type === 'auto' ? stringifyJson(rules) : null,
        isActive: input.isActive ?? existing.IS_ACTIVE,
      });

      // Switching manual -> auto abandons the hand-picked list rather than
      // leaving rows that no longer decide anything.
      if (type === 'auto' && existing.TYPE === 'manual') {
        await repo.deleteCollProds(conn, { companyId, collId: id });
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return getColl({ companyId, id });
}

export async function deleteColl({ companyId, id }) {
  return withCompany(companyId, async (conn) => {
    const existing = await repo.findCollById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'COLL_NOT_FOUND', 'Collection not found.');
    }

    // Membership rows go; the products themselves are untouched.
    const unlinkedProducts = await repo.deleteCollProds(conn, { companyId, collId: id });
    await repo.deleteCollById(conn, { companyId, id });
    await conn.commit();

    return { unlinkedProducts };
  });
}

/**
 * @param {{ companyId: number, id: number, page: number, pageSize: number, activeOnly?: boolean }} args
 */
export async function listCollProducts({ companyId, id, page, pageSize, activeOnly = false }) {
  const { coll, rows, total } = await withCompany(companyId, async (conn) => {
    const collRow = await repo.findCollById(conn, { companyId, id });
    if (!collRow) return { coll: null };

    const isAuto = collRow.TYPE === 'auto';
    const compiled = isAuto ? repo.compileRules(parseJson(collRow.RULES, null)) : null;

    const result = await repo.listCollProducts(conn, {
      companyId,
      collId: id,
      isAuto,
      ruleSql: compiled?.sql,
      ruleBinds: compiled?.binds,
      page,
      pageSize,
      activeOnly,
    });

    return { coll: collRow, ...result };
  });

  if (!coll) {
    throw new AppError(404, 'COLL_NOT_FOUND', 'Collection not found.');
  }

  return { rows: rows.map(toProductCard), total, page, pageSize };
}

export async function setCollProducts({ companyId, id, productIds }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findCollById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'COLL_NOT_FOUND', 'Collection not found.');
    }
    if (existing.TYPE === 'auto') {
      throw new AppError(
        409,
        'COLL_IS_AUTOMATIC',
        'This collection picks its own products from its rules. Switch it to manual to choose them by hand.',
      );
    }

    try {
      await replaceMembers(conn, { companyId, collId: id, productIds });
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      rethrowAsBadReference(err);
    }
  });

  return listCollProducts({ companyId, id, page: 1, pageSize: 100 });
}

export async function reorderCollProducts({ companyId, id, items }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findCollById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'COLL_NOT_FOUND', 'Collection not found.');
    }
    if (existing.TYPE === 'auto') {
      throw new AppError(409, 'COLL_IS_AUTOMATIC', 'An automatic collection has no hand-set order.');
    }

    const members = new Set(await repo.listCollProductIds(conn, { companyId, collId: id }));
    for (const item of items) {
      if (!members.has(item.productId)) {
        throw new AppError(404, 'PRODUCT_NOT_IN_COLL', `Product ${item.productId} is not in this collection.`);
      }
    }

    for (const item of items) {
      await repo.updateCollProdPosition(conn, {
        companyId,
        collId: id,
        productId: item.productId,
        position: item.position,
      });
    }

    await conn.commit();
  });

  return listCollProducts({ companyId, id, page: 1, pageSize: 100 });
}
