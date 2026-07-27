import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

const PRODUCT_COLUMNS = `id, company_id, name, slug, descr, short_desc, brand, is_active, is_featured,
                         tags, meta_title, meta_desc, created_at, updated_at`;

const VARIANT_COLUMNS = `id, company_id, product_id, sku, barcode, name, opts, price, sale_price, cost,
                         stock, weight, is_default, position, is_active, created_at, updated_at`;

/** Whitelisted sort columns — the only place a sort key reaches the SQL text. */
const SORT_COLUMNS = {
  name: 'p.name',
  price: 'v.price',
  created: 'p.created_at',
  updated: 'p.updated_at',
};

/* ------------------------------------------------------------------ products */

export async function insertProduct(conn, product) {
  const result = await conn.execute(
    `INSERT INTO products (company_id, name, slug, descr, short_desc, brand, is_active, is_featured,
                           tags, meta_title, meta_desc)
     VALUES (:companyId, :name, :slug, :descr, :shortDesc, :brand, :isActive, :isFeatured,
             :tags, :metaTitle, :metaDesc)
     RETURNING id INTO :id`,
    { ...product, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function findProductById(conn, { companyId, id, includeDeleted = false }) {
  const result = await conn.execute(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE id = :id AND company_id = :companyId
        AND (:includeDeleted = 1 OR deleted_at IS NULL)`,
    { id, companyId, includeDeleted: includeDeleted ? 1 : 0 },
  );
  return result.rows[0] ?? null;
}

export async function findProductBySlug(conn, { companyId, slug, activeOnly = false }) {
  const result = await conn.execute(
    `SELECT ${PRODUCT_COLUMNS} FROM products
      WHERE slug = :slug AND company_id = :companyId AND deleted_at IS NULL
        AND (:activeOnly = 0 OR is_active = 1)`,
    { slug, companyId, activeOnly: activeOnly ? 1 : 0 },
  );
  return result.rows[0] ?? null;
}

export async function updateProduct(conn, product) {
  const result = await conn.execute(
    `UPDATE products
        SET name = :name, slug = :slug, descr = :descr, short_desc = :shortDesc, brand = :brand,
            is_active = :isActive, is_featured = :isFeatured, tags = :tags,
            meta_title = :metaTitle, meta_desc = :metaDesc, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId AND deleted_at IS NULL`,
    product,
  );
  return result.rowsAffected > 0;
}

export async function softDeleteProduct(conn, { companyId, id }) {
  const result = await conn.execute(
    `UPDATE products SET deleted_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId AND deleted_at IS NULL`,
    { id, companyId },
  );
  return result.rowsAffected > 0;
}

/**
 * Soft-deleted rows still hold their slug — the unique index does not know about
 * `deleted_at` — so slug generation has to see them too. Hence no deleted filter.
 */
export async function findSlugsStartingWith(conn, { companyId, base, excludeId }) {
  const result = await conn.execute(
    `SELECT slug FROM products
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

/**
 * Listing rows: product + its default variant + its primary image, in one
 * statement. The window function picks the lowest-position image per product so
 * the join stays flat — no second query, no per-row lookup.
 *
 * Returns { rows, total } using exactly two statements regardless of page size;
 * tests/integration/products.test.js asserts that count does not grow with the
 * number of products.
 */
export async function listProducts(conn, { companyId, page, pageSize, search, catId, collId, isActive, isFeatured, sort, dir }) {
  const offset = (page - 1) * pageSize;
  const searchPattern = search ? `%${search.toLowerCase()}%` : null;
  const sortColumn = SORT_COLUMNS[sort] ?? SORT_COLUMNS.created;
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const from = `
      FROM products p
      LEFT JOIN variants v
        ON v.company_id = p.company_id AND v.product_id = p.id AND v.is_default = 1`;

  const where = `
     WHERE p.company_id = :companyId
       AND p.deleted_at IS NULL
       AND (:isActive1 IS NULL OR p.is_active = :isActive2)
       AND (:isFeatured1 IS NULL OR p.is_featured = :isFeatured2)
       AND (:catId1 IS NULL OR EXISTS (
             SELECT 1 FROM prod_cats pc
              WHERE pc.company_id = p.company_id AND pc.product_id = p.id AND pc.cat_id = :catId2))
       AND (:collId1 IS NULL OR EXISTS (
             SELECT 1 FROM coll_prods cp
              WHERE cp.company_id = p.company_id AND cp.coll_id = :collId2 AND cp.product_id = p.id))
       AND (:search1 IS NULL
             OR LOWER(p.name) LIKE :search2
             OR LOWER(p.brand) LIKE :search3
             OR EXISTS (
                  SELECT 1 FROM variants sv
                   WHERE sv.company_id = p.company_id AND sv.product_id = p.id
                     AND LOWER(sv.sku) LIKE :search4))`;

  const filterBinds = {
    companyId,
    isActive1: isActive ?? null,
    isActive2: isActive ?? null,
    isFeatured1: isFeatured ?? null,
    isFeatured2: isFeatured ?? null,
    catId1: catId ?? null,
    catId2: catId ?? null,
    collId1: collId ?? null,
    collId2: collId ?? null,
    search1: searchPattern,
    search2: searchPattern,
    search3: searchPattern,
    search4: searchPattern,
  };

  const rowsResult = await conn.execute(
    `SELECT p.id, p.name, p.slug, p.short_desc, p.brand, p.is_active, p.is_featured, p.tags,
            p.created_at, p.updated_at,
            v.id AS variant_id, v.sku, v.price, v.sale_price, v.stock,
            img.media_id AS image_media_id, img.alt AS image_alt
       ${from}
       LEFT JOIN (
         SELECT company_id, product_id, media_id, alt,
                ROW_NUMBER() OVER (PARTITION BY company_id, product_id ORDER BY position, id) AS rn
           FROM prod_imgs
       ) img ON img.company_id = p.company_id AND img.product_id = p.id AND img.rn = 1
       ${where}
     ORDER BY ${sortColumn} ${sortDir}, p.id DESC
     OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...filterBinds, offset, pageSize },
  );

  const countResult = await conn.execute(
    `SELECT COUNT(*) AS cnt ${from} ${where}`,
    filterBinds,
  );

  return { rows: rowsResult.rows, total: countResult.rows[0].CNT };
}

export async function bulkSetActive(conn, { companyId, ids, isActive }) {
  const { clause, binds } = idListClause(ids);
  const result = await conn.execute(
    `UPDATE products SET is_active = :isActive, updated_at = SYSTIMESTAMP
      WHERE company_id = :companyId AND deleted_at IS NULL AND id IN (${clause})`,
    { companyId, isActive, ...binds },
  );
  return result.rowsAffected;
}

export async function bulkSoftDelete(conn, { companyId, ids }) {
  const { clause, binds } = idListClause(ids);
  const result = await conn.execute(
    `UPDATE products SET deleted_at = SYSTIMESTAMP, updated_at = SYSTIMESTAMP
      WHERE company_id = :companyId AND deleted_at IS NULL AND id IN (${clause})`,
    { companyId, ...binds },
  );
  return result.rowsAffected;
}

/** Builds `:id0, :id1, ...` — ids are numbers from zod, never interpolated text. */
function idListClause(ids) {
  const binds = {};
  const names = ids.map((id, index) => {
    binds[`id${index}`] = id;
    return `:id${index}`;
  });
  return { clause: names.join(', '), binds };
}

/* ----------------------------------------------------------------- variants */

export async function insertVariant(conn, variant) {
  const result = await conn.execute(
    `INSERT INTO variants (company_id, product_id, sku, barcode, name, opts, price, sale_price, cost,
                           stock, weight, is_default, position, is_active)
     VALUES (:companyId, :productId, :sku, :barcode, :name, :opts, :price, :salePrice, :cost,
             :stock, :weight, :isDefault, :position, :isActive)
     RETURNING id INTO :id`,
    { ...variant, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function listVariants(conn, { companyId, productId }) {
  const result = await conn.execute(
    `SELECT ${VARIANT_COLUMNS} FROM variants
      WHERE company_id = :companyId AND product_id = :productId
      ORDER BY is_default DESC, position, id`,
    { companyId, productId },
  );
  return result.rows;
}

export async function findVariantById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${VARIANT_COLUMNS} FROM variants WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function updateVariant(conn, variant) {
  const result = await conn.execute(
    `UPDATE variants
        SET sku = :sku, barcode = :barcode, name = :name, opts = :opts, price = :price,
            sale_price = :salePrice, cost = :cost, stock = :stock, weight = :weight,
            position = :position, is_active = :isActive, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    variant,
  );
  return result.rowsAffected > 0;
}

export async function setVariantStock(conn, { companyId, id, stock }) {
  const result = await conn.execute(
    `UPDATE variants SET stock = :stock, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    { id, companyId, stock },
  );
  return result.rowsAffected > 0;
}

/**
 * The unique index only allows one default per product, so the old default has
 * to be cleared before the new one is set — never the other way round.
 */
export async function clearDefaultVariant(conn, { companyId, productId }) {
  await conn.execute(
    `UPDATE variants SET is_default = 0, updated_at = SYSTIMESTAMP
      WHERE company_id = :companyId AND product_id = :productId AND is_default = 1`,
    { companyId, productId },
  );
}

export async function markVariantDefault(conn, { companyId, id }) {
  await conn.execute(
    `UPDATE variants SET is_default = 1, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
}

export async function deleteVariantById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM variants WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

export async function countVariants(conn, { companyId, productId }) {
  const result = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM variants WHERE company_id = :companyId AND product_id = :productId',
    { companyId, productId },
  );
  return result.rows[0].CNT;
}

/* ------------------------------------------------------------------ options */

export async function listOptions(conn, { companyId, productId }) {
  const result = await conn.execute(
    `SELECT id, product_id, name, vals, position FROM options
      WHERE company_id = :companyId AND product_id = :productId
      ORDER BY position, id`,
    { companyId, productId },
  );
  return result.rows;
}

export async function deleteOptionsByProduct(conn, { companyId, productId }) {
  await conn.execute('DELETE FROM options WHERE company_id = :companyId AND product_id = :productId', {
    companyId,
    productId,
  });
}

export async function insertOption(conn, { companyId, productId, name, vals, position }) {
  await conn.execute(
    `INSERT INTO options (company_id, product_id, name, vals, position)
     VALUES (:companyId, :productId, :name, :vals, :position)`,
    { companyId, productId, name, vals, position },
  );
}

/* ------------------------------------------------------------------- images */

export async function listProductImages(conn, { companyId, productId }) {
  const result = await conn.execute(
    `SELECT pi.id, pi.product_id, pi.media_id, pi.alt, pi.position,
            m.filename, m.storage_key, m.width, m.height
       FROM prod_imgs pi
       JOIN media m ON m.company_id = pi.company_id AND m.id = pi.media_id
      WHERE pi.company_id = :companyId AND pi.product_id = :productId
      ORDER BY pi.position, pi.id`,
    { companyId, productId },
  );
  return result.rows;
}

export async function insertProductImage(conn, { companyId, productId, mediaId, alt, position }) {
  const result = await conn.execute(
    `INSERT INTO prod_imgs (company_id, product_id, media_id, alt, position)
     VALUES (:companyId, :productId, :mediaId, :alt, :position)
     RETURNING id INTO :id`,
    { companyId, productId, mediaId, alt, position, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function nextImagePosition(conn, { companyId, productId }) {
  const result = await conn.execute(
    `SELECT NVL(MAX(position), -1) + 1 AS next FROM prod_imgs
      WHERE company_id = :companyId AND product_id = :productId`,
    { companyId, productId },
  );
  return result.rows[0].NEXT;
}

export async function findProductImageById(conn, { companyId, productId, id }) {
  const result = await conn.execute(
    `SELECT id, product_id, media_id, alt, position FROM prod_imgs
      WHERE id = :id AND product_id = :productId AND company_id = :companyId`,
    { id, productId, companyId },
  );
  return result.rows[0] ?? null;
}

export async function updateProductImage(conn, { companyId, id, alt }) {
  const result = await conn.execute(
    'UPDATE prod_imgs SET alt = :alt WHERE id = :id AND company_id = :companyId',
    { id, companyId, alt },
  );
  return result.rowsAffected > 0;
}

export async function updateProductImagePosition(conn, { companyId, productId, id, position }) {
  const result = await conn.execute(
    `UPDATE prod_imgs SET position = :position
      WHERE id = :id AND product_id = :productId AND company_id = :companyId`,
    { id, productId, companyId, position },
  );
  return result.rowsAffected > 0;
}

export async function deleteProductImageById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM prod_imgs WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

/* --------------------------------------------------------------- categories */

export async function listProductCatIds(conn, { companyId, productId }) {
  const result = await conn.execute(
    'SELECT cat_id FROM prod_cats WHERE company_id = :companyId AND product_id = :productId ORDER BY cat_id',
    { companyId, productId },
  );
  return result.rows.map((row) => row.CAT_ID);
}

export async function deleteProductCats(conn, { companyId, productId }) {
  await conn.execute('DELETE FROM prod_cats WHERE company_id = :companyId AND product_id = :productId', {
    companyId,
    productId,
  });
}

export async function insertProductCat(conn, { companyId, productId, catId }) {
  await conn.execute(
    'INSERT INTO prod_cats (company_id, product_id, cat_id) VALUES (:companyId, :productId, :catId)',
    { companyId, productId, catId },
  );
}

export async function listProductCollIds(conn, { companyId, productId }) {
  const result = await conn.execute(
    'SELECT coll_id FROM coll_prods WHERE company_id = :companyId AND product_id = :productId ORDER BY coll_id',
    { companyId, productId },
  );
  return result.rows.map((row) => row.COLL_ID);
}
