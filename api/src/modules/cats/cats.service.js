import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { slugify, resolveSlug } from '../../lib/slug.js';
import { buildTree, findCycle } from '../../lib/tree.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import { isForeignKeyViolation } from '../../lib/dbErrors.js';
import {
  insertCat,
  findCatById,
  countCatDependents,
  listCats as listCatRows,
  listCatsForTree,
  listCatParentPairs,
  findSlugsStartingWith,
  updateCat as updateCatRow,
  updateCatPlacement,
  deleteProdCatsByCat,
  deleteCatById,
} from './cats.repo.js';

/**
 * The image FK is (company_id, image_id) -> media(company_id, id), so Oracle
 * already refuses an image belonging to another company. Translating its error
 * beats spending a SELECT to re-ask a question the constraint answers.
 */
function rethrowAsBadReference(err) {
  if (isForeignKeyViolation(err, 'cats_image_fk')) {
    throw new AppError(400, 'IMAGE_NOT_FOUND', 'That image does not exist in this store.');
  }
  if (isForeignKeyViolation(err, 'cats_parent_fk')) {
    throw new AppError(400, 'PARENT_NOT_FOUND', 'That parent category does not exist in this store.');
  }
  throw err;
}

async function nextFreeSlug(conn, { companyId, desired, fallbackFrom, excludeId }) {
  const base = desired ? slugify(desired) : slugify(fallbackFrom);
  const taken = await findSlugsStartingWith(conn, { companyId, base, excludeId });
  return resolveSlug(base, taken);
}

async function assertParentExists(conn, { companyId, parentId }) {
  const pairs = await listCatParentPairs(conn, { companyId });
  if (!pairs.some((row) => row.ID === parentId)) {
    throw new AppError(400, 'PARENT_NOT_FOUND', 'That parent category does not exist in this store.');
  }
}

/**
 * Loads the whole parent graph once, applies the proposed edges, and reports the
 * first node that would end up inside its own subtree. Used by both the single
 * update and the bulk reorder so the rule cannot drift between them.
 */
async function assertPlacementIsAcyclic(conn, { companyId, changes }) {
  const pairs = await listCatParentPairs(conn, { companyId });
  const parentById = new Map(pairs.map((row) => [row.ID, row.PARENT_ID]));

  for (const change of changes) {
    if (!parentById.has(change.id)) {
      throw new AppError(404, 'CAT_NOT_FOUND', `Category ${change.id} not found.`);
    }
    if (change.parentId === undefined) continue;
    if (change.parentId !== null && !parentById.has(change.parentId)) {
      throw new AppError(400, 'PARENT_NOT_FOUND', `Parent category ${change.parentId} not found.`);
    }
    if (change.parentId === change.id) {
      throw new AppError(400, 'CIRCULAR_PARENT', 'A category cannot be its own parent.');
    }
    parentById.set(change.id, change.parentId);
  }

  const cycle = findCycle(parentById);
  if (cycle !== null) {
    throw new AppError(
      400,
      'CIRCULAR_PARENT',
      `Category ${cycle} would end up inside its own subtree.`,
    );
  }

  return parentById;
}

export async function createCat({ companyId, ...input }) {
  return withCompany(companyId, async (conn) => {
    const slug = await nextFreeSlug(conn, { companyId, desired: input.slug, fallbackFrom: input.name });

    // A row that does not exist yet cannot close a cycle, so this only has to
    // establish that the parent is real and belongs to this company. Reporting a
    // missing parent as 400 PARENT_NOT_FOUND, not 404, keeps "the category you
    // asked for" and "the parent you named" distinguishable to the caller.
    if (input.parentId != null) {
      await assertParentExists(conn, { companyId, parentId: input.parentId });
    }

    let id;
    try {
      id = await insertCat(conn, {
        companyId,
        parentId: input.parentId ?? null,
        name: input.name,
        slug,
        descr: input.descr ?? null,
        imageId: input.imageId ?? null,
        position: input.position ?? 0,
        isActive: input.isActive ?? 1,
        metaTitle: input.metaTitle ?? null,
        metaDesc: input.metaDesc ?? null,
      });
    } catch (err) {
      rethrowAsBadReference(err);
    }

    await conn.commit();
    return camelRow(await findCatById(conn, { companyId, id }));
  });
}

export async function listCats({ companyId, ...filters }) {
  const rows = await withCompany(companyId, (conn) => listCatRows(conn, { companyId, ...filters }));
  return { rows: camelRows(rows) };
}

export async function getCatTree({ companyId, isActive }) {
  const rows = await withCompany(companyId, (conn) => listCatsForTree(conn, { companyId, isActive }));
  const tree = buildTree(camelRows(rows), {
    sortBy: (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  });
  return { tree };
}

export async function getCat({ companyId, id }) {
  const result = await withCompany(companyId, async (conn) => {
    const row = await findCatById(conn, { companyId, id });
    if (!row) return null;
    const counts = await countCatDependents(conn, { companyId, id });
    return { row, counts };
  });

  if (!result) {
    throw new AppError(404, 'CAT_NOT_FOUND', 'Category not found.');
  }
  return { ...camelRow(result.row), ...result.counts };
}

export async function patchCat({ companyId, id, ...input }) {
  return withCompany(companyId, async (conn) => {
    const existing = await findCatById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'CAT_NOT_FOUND', 'Category not found.');
    }

    if (input.parentId !== undefined) {
      await assertPlacementIsAcyclic(conn, { companyId, changes: [{ id, parentId: input.parentId ?? null }] });
    }

    const renaming = input.slug !== undefined || (input.name !== undefined && input.name !== existing.NAME);
    const slug = renaming
      ? await nextFreeSlug(conn, {
          companyId,
          desired: input.slug ?? input.name,
          fallbackFrom: input.name ?? existing.NAME,
          excludeId: id,
        })
      : existing.SLUG;

    const merged = {
      id,
      companyId,
      parentId: input.parentId !== undefined ? (input.parentId ?? null) : existing.PARENT_ID,
      name: input.name ?? existing.NAME,
      slug,
      descr: input.descr !== undefined ? input.descr : existing.DESCR,
      imageId: input.imageId !== undefined ? (input.imageId ?? null) : existing.IMAGE_ID,
      position: input.position ?? existing.POSITION,
      isActive: input.isActive ?? existing.IS_ACTIVE,
      metaTitle: input.metaTitle !== undefined ? input.metaTitle : existing.META_TITLE,
      metaDesc: input.metaDesc !== undefined ? input.metaDesc : existing.META_DESC,
    };

    try {
      await updateCatRow(conn, merged);
    } catch (err) {
      rethrowAsBadReference(err);
    }

    await conn.commit();
    return camelRow(await findCatById(conn, { companyId, id }));
  });
}

/**
 * Whole reorder in one transaction: either every category lands where the admin
 * dropped it, or the tree is untouched and the UI rolls back.
 */
export async function reorderCats({ companyId, items }) {
  return withCompany(companyId, async (conn) => {
    const parentById = await assertPlacementIsAcyclic(conn, {
      companyId,
      changes: items.map((item) => ({
        id: item.id,
        parentId: item.parentId === undefined ? undefined : (item.parentId ?? null),
      })),
    });

    for (const item of items) {
      await updateCatPlacement(conn, {
        companyId,
        id: item.id,
        parentId: parentById.get(item.id) ?? null,
        position: item.position,
      });
    }

    await conn.commit();

    const rows = await listCatsForTree(conn, { companyId, isActive: undefined });
    return {
      tree: buildTree(camelRows(rows), {
        sortBy: (a, b) => a.position - b.position || a.name.localeCompare(b.name),
      }),
    };
  });
}

/**
 * Refuses while subcategories exist — silently orphaning or cascading a whole
 * branch is not something an admin can undo. Product links go, products do not.
 */
export async function deleteCat({ companyId, id }) {
  return withCompany(companyId, async (conn) => {
    const existing = await findCatById(conn, { companyId, id });
    if (!existing) {
      throw new AppError(404, 'CAT_NOT_FOUND', 'Category not found.');
    }

    const { childCount } = await countCatDependents(conn, { companyId, id });
    if (childCount > 0) {
      throw new AppError(
        409,
        'CAT_HAS_CHILDREN',
        `Move or delete this category's ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'} first.`,
      );
    }

    const unlinkedProducts = await deleteProdCatsByCat(conn, { companyId, catId: id });
    await deleteCatById(conn, { companyId, id });
    await conn.commit();

    return { unlinkedProducts };
  });
}
