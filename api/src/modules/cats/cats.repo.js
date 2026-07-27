import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

const COLUMNS = `id, company_id, parent_id, name, slug, descr, image_id, position, is_active,
                 meta_title, meta_desc, created_at, updated_at`;

// Categories are a handful to a few hundred per store, never a paginated list —
// the admin tree and the storefront nav both need the whole set at once. The cap
// exists so a pathological data set can't return unbounded rows.
const MAX_ROWS = 1000;

export async function insertCat(conn, cat) {
  const result = await conn.execute(
    `INSERT INTO cats (company_id, parent_id, name, slug, descr, image_id, position, is_active,
                       meta_title, meta_desc)
     VALUES (:companyId, :parentId, :name, :slug, :descr, :imageId, :position, :isActive,
             :metaTitle, :metaDesc)
     RETURNING id INTO :id`,
    {
      companyId: cat.companyId,
      parentId: cat.parentId,
      name: cat.name,
      slug: cat.slug,
      descr: cat.descr,
      imageId: cat.imageId,
      position: cat.position,
      isActive: cat.isActive,
      metaTitle: cat.metaTitle,
      metaDesc: cat.metaDesc,
      id: OUT_ID,
    },
  );
  return result.outBinds.id[0];
}

export async function findCatById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${COLUMNS} FROM cats WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findCatBySlug(conn, { companyId, slug }) {
  const result = await conn.execute(
    `SELECT ${COLUMNS} FROM cats WHERE slug = :slug AND company_id = :companyId`,
    { slug, companyId },
  );
  return result.rows[0] ?? null;
}

/**
 * One extra round trip, used only by the single-category read, so the admin's
 * delete confirmation can say exactly what it is about to affect.
 */
export async function countCatDependents(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT
       (SELECT COUNT(*) FROM cats c WHERE c.company_id = :companyId1 AND c.parent_id = :id1) AS child_count,
       (SELECT COUNT(*) FROM prod_cats pc WHERE pc.company_id = :companyId2 AND pc.cat_id = :id2) AS product_count
     FROM dual`,
    { companyId1: companyId, id1: id, companyId2: companyId, id2: id },
  );
  return { childCount: result.rows[0].CHILD_COUNT, productCount: result.rows[0].PRODUCT_COUNT };
}

export async function listCats(conn, { companyId, parentId, rootOnly, isActive, search }) {
  const searchPattern = search ? `%${search.toLowerCase()}%` : null;

  const result = await conn.execute(
    `SELECT ${COLUMNS}
       FROM cats
      WHERE company_id = :companyId
        AND (:rootOnly = 0 OR parent_id IS NULL)
        AND (:parentId1 IS NULL OR parent_id = :parentId2)
        AND (:isActive1 IS NULL OR is_active = :isActive2)
        AND (:search1 IS NULL OR LOWER(name) LIKE :search2 OR LOWER(slug) LIKE :search3)
      ORDER BY position, name
      FETCH FIRST ${MAX_ROWS} ROWS ONLY`,
    {
      companyId,
      rootOnly: rootOnly ? 1 : 0,
      parentId1: parentId ?? null,
      parentId2: parentId ?? null,
      isActive1: isActive ?? null,
      isActive2: isActive ?? null,
      search1: searchPattern,
      search2: searchPattern,
      search3: searchPattern,
    },
  );
  return result.rows;
}

/** Flat rows for the tree endpoint; nesting happens in JS (see lib/tree.js). */
export async function listCatsForTree(conn, { companyId, isActive }) {
  const result = await conn.execute(
    `SELECT id, parent_id, name, slug, image_id, position, is_active
       FROM cats
      WHERE company_id = :companyId
        AND (:isActive1 IS NULL OR is_active = :isActive2)
      ORDER BY position, name
      FETCH FIRST ${MAX_ROWS} ROWS ONLY`,
    { companyId, isActive1: isActive ?? null, isActive2: isActive ?? null },
  );
  return result.rows;
}

/** Just the edges — enough to validate parenting without loading every column. */
export async function listCatParentPairs(conn, { companyId }) {
  const result = await conn.execute(
    `SELECT id, parent_id FROM cats WHERE company_id = :companyId FETCH FIRST ${MAX_ROWS} ROWS ONLY`,
    { companyId },
  );
  return result.rows;
}

/**
 * Every slug that could collide with `base` — the slug itself plus any `base-N`.
 * One query instead of probing candidates in a loop.
 */
export async function findSlugsStartingWith(conn, { companyId, base, excludeId }) {
  const result = await conn.execute(
    `SELECT slug
       FROM cats
      WHERE company_id = :companyId
        AND (slug = :base OR slug LIKE :basePattern)
        AND (:excludeId1 IS NULL OR id <> :excludeId2)`,
    {
      companyId,
      base,
      basePattern: `${base}-%`,
      excludeId1: excludeId ?? null,
      excludeId2: excludeId ?? null,
    },
  );
  return result.rows.map((row) => row.SLUG);
}

export async function updateCat(conn, cat) {
  const result = await conn.execute(
    `UPDATE cats
        SET parent_id = :parentId,
            name = :name,
            slug = :slug,
            descr = :descr,
            image_id = :imageId,
            position = :position,
            is_active = :isActive,
            meta_title = :metaTitle,
            meta_desc = :metaDesc,
            updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    {
      id: cat.id,
      companyId: cat.companyId,
      parentId: cat.parentId,
      name: cat.name,
      slug: cat.slug,
      descr: cat.descr,
      imageId: cat.imageId,
      position: cat.position,
      isActive: cat.isActive,
      metaTitle: cat.metaTitle,
      metaDesc: cat.metaDesc,
    },
  );
  return result.rowsAffected > 0;
}

export async function updateCatPlacement(conn, { companyId, id, parentId, position }) {
  const result = await conn.execute(
    `UPDATE cats
        SET parent_id = :parentId, position = :position, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    { id, companyId, parentId, position },
  );
  return result.rowsAffected > 0;
}

export async function deleteProdCatsByCat(conn, { companyId, catId }) {
  const result = await conn.execute(
    'DELETE FROM prod_cats WHERE company_id = :companyId AND cat_id = :catId',
    { companyId, catId },
  );
  return result.rowsAffected;
}

export async function deleteCatById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM cats WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}
