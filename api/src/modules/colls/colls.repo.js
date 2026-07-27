import oracledb from 'oracledb';
import { AppError } from '../../middleware/error.js';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

const COLL_COLUMNS = `id, company_id, name, slug, descr, image_id, type, rules, is_active,
                      created_at, updated_at`;

/* ------------------------------------------------------------- rule engine */

/**
 * The grammar for `colls.rules`, closed on purpose:
 *
 *   { match: 'all' | 'any', conditions: [ { field, op, value }, ... ] }
 *
 * Each field declares which operators it accepts and how it becomes SQL. Values
 * only ever reach the database as bind variables — the generated text contains
 * placeholders and nothing else — so a rule can never carry SQL into the query.
 * Anything outside this table is a 400, not a silently ignored condition.
 */
const RULE_FIELDS = {
  cat_id: {
    ops: ['eq', 'neq', 'in'],
    coerce: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) throw invalidRule('cat_id expects a category id.');
      return n;
    },
    build: (op, binds) => {
      const exists = `EXISTS (SELECT 1 FROM prod_cats rpc
                               WHERE rpc.company_id = p.company_id
                                 AND rpc.product_id = p.id
                                 AND rpc.cat_id ${op === 'in' ? `IN (${binds.join(', ')})` : `= ${binds[0]}`})`;
      return op === 'neq' ? `NOT ${exists}` : exists;
    },
  },
  brand: {
    ops: ['eq', 'neq', 'in'],
    coerce: (value) => {
      if (typeof value !== 'string' || !value.trim()) throw invalidRule('brand expects a name.');
      return value.trim();
    },
    build: (op, binds) => {
      if (op === 'in') return `LOWER(p.brand) IN (${binds.map((b) => `LOWER(${b})`).join(', ')})`;
      if (op === 'neq') return `(p.brand IS NULL OR LOWER(p.brand) <> LOWER(${binds[0]}))`;
      return `LOWER(p.brand) = LOWER(${binds[0]})`;
    },
  },
  tag: {
    ops: ['eq', 'in'],
    coerce: (value) => {
      if (typeof value !== 'string' || !value.trim()) throw invalidRule('tag expects a tag name.');
      return value.trim();
    },
    // products.tags is a JSON array in a CLOB; JSON_EXISTS with a PASSING bind
    // is the only form that keeps the value out of the path expression text.
    build: (op, binds) =>
      binds.map((bind) => `JSON_EXISTS(p.tags, '$[*]?(@ == $t)' PASSING ${bind} AS "t")`).join(' OR '),
  },
  price: {
    ops: ['eq', 'gt', 'lt'],
    coerce: (value) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw invalidRule('price expects a non-negative number.');
      return n;
    },
    // v is the default-variant join — the price a shopper actually sees.
    build: (op, binds) => `v.price ${{ eq: '=', gt: '>', lt: '<' }[op]} ${binds[0]}`,
  },
  is_featured: {
    ops: ['eq'],
    coerce: (value) => (value === true || value === 1 || value === '1' ? 1 : 0),
    build: (_op, binds) => `p.is_featured = ${binds[0]}`,
  },
};

function invalidRule(message) {
  return new AppError(400, 'INVALID_RULE', message);
}

/**
 * @param {{match?: string, conditions?: Array<{field: string, op: string, value: any}>}} rules
 * @returns {{ sql: string, binds: Record<string, any> } | null} null when there is nothing to filter by
 */
export function compileRules(rules) {
  const conditions = rules?.conditions ?? [];
  if (conditions.length === 0) return null;

  const joiner = rules.match === 'any' ? ' OR ' : ' AND ';
  const binds = {};
  const fragments = [];

  conditions.forEach((condition, index) => {
    const spec = RULE_FIELDS[condition.field];
    if (!spec) {
      throw invalidRule(`Unknown rule field "${condition.field}".`);
    }
    if (!spec.ops.includes(condition.op)) {
      throw invalidRule(`Field "${condition.field}" does not support "${condition.op}".`);
    }

    const values = condition.op === 'in' ? condition.value : [condition.value];
    if (condition.op === 'in' && (!Array.isArray(values) || values.length === 0 || values.length > 50)) {
      throw invalidRule('An "in" rule needs between 1 and 50 values.');
    }

    const bindNames = values.map((value, valueIndex) => {
      const name = `rule${index}_${valueIndex}`;
      binds[name] = spec.coerce(value);
      return `:${name}`;
    });

    fragments.push(`(${spec.build(condition.op, bindNames)})`);
  });

  return { sql: `(${fragments.join(joiner)})`, binds };
}

/* ---------------------------------------------------------------- colls CRUD */

export async function insertColl(conn, coll) {
  const result = await conn.execute(
    `INSERT INTO colls (company_id, name, slug, descr, image_id, type, rules, is_active)
     VALUES (:companyId, :name, :slug, :descr, :imageId, :type, :rules, :isActive)
     RETURNING id INTO :id`,
    { ...coll, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function findCollById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${COLL_COLUMNS} FROM colls WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findCollBySlug(conn, { companyId, slug }) {
  const result = await conn.execute(
    `SELECT ${COLL_COLUMNS} FROM colls WHERE slug = :slug AND company_id = :companyId`,
    { slug, companyId },
  );
  return result.rows[0] ?? null;
}

export async function listColls(conn, { companyId, page, pageSize, search, type, isActive }) {
  const offset = (page - 1) * pageSize;
  const searchPattern = search ? `%${search.toLowerCase()}%` : null;

  const where = `WHERE company_id = :companyId
       AND (:type1 IS NULL OR type = :type2)
       AND (:isActive1 IS NULL OR is_active = :isActive2)
       AND (:search1 IS NULL OR LOWER(name) LIKE :search2 OR LOWER(slug) LIKE :search3)`;
  const filterBinds = {
    companyId,
    type1: type ?? null,
    type2: type ?? null,
    isActive1: isActive ?? null,
    isActive2: isActive ?? null,
    search1: searchPattern,
    search2: searchPattern,
    search3: searchPattern,
  };

  const rowsResult = await conn.execute(
    `SELECT ${COLL_COLUMNS},
            (SELECT COUNT(*) FROM coll_prods cp
              WHERE cp.company_id = colls.company_id AND cp.coll_id = colls.id) AS manual_count
       FROM colls ${where}
      ORDER BY name
      OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...filterBinds, offset, pageSize },
  );

  const countResult = await conn.execute(`SELECT COUNT(*) AS cnt FROM colls ${where}`, filterBinds);

  return { rows: rowsResult.rows, total: countResult.rows[0].CNT };
}

export async function findSlugsStartingWith(conn, { companyId, base, excludeId }) {
  const result = await conn.execute(
    `SELECT slug FROM colls
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

export async function updateColl(conn, coll) {
  const result = await conn.execute(
    `UPDATE colls
        SET name = :name, slug = :slug, descr = :descr, image_id = :imageId, type = :type,
            rules = :rules, is_active = :isActive, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    coll,
  );
  return result.rowsAffected > 0;
}

export async function deleteCollById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM colls WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

/* ------------------------------------------------------------- membership */

export async function deleteCollProds(conn, { companyId, collId }) {
  const result = await conn.execute(
    'DELETE FROM coll_prods WHERE company_id = :companyId AND coll_id = :collId',
    { companyId, collId },
  );
  return result.rowsAffected;
}

export async function insertCollProd(conn, { companyId, collId, productId, position }) {
  await conn.execute(
    `INSERT INTO coll_prods (company_id, coll_id, product_id, position)
     VALUES (:companyId, :collId, :productId, :position)`,
    { companyId, collId, productId, position },
  );
}

export async function updateCollProdPosition(conn, { companyId, collId, productId, position }) {
  const result = await conn.execute(
    `UPDATE coll_prods SET position = :position
      WHERE company_id = :companyId AND coll_id = :collId AND product_id = :productId`,
    { companyId, collId, productId, position },
  );
  return result.rowsAffected > 0;
}

export async function listCollProductIds(conn, { companyId, collId }) {
  const result = await conn.execute(
    `SELECT product_id FROM coll_prods
      WHERE company_id = :companyId AND coll_id = :collId
      ORDER BY position, product_id`,
    { companyId, collId },
  );
  return result.rows.map((row) => row.PRODUCT_ID);
}

/**
 * Members of a collection, in the same shape the product listing uses (default
 * variant + primary image inline, two statements total).
 *
 * A manual collection orders by `coll_prods.position`; an automatic one is
 * whatever currently matches its rules. `ruleSql` comes only from
 * `compileRules` above and contains bind placeholders exclusively.
 */
export async function listCollProducts(conn, { companyId, collId, isAuto, ruleSql, ruleBinds, page, pageSize, activeOnly }) {
  const offset = (page - 1) * pageSize;

  const membership = isAuto
    ? `AND ${ruleSql ?? '1 = 1'}`
    : `AND EXISTS (SELECT 1 FROM coll_prods cp
                    WHERE cp.company_id = p.company_id AND cp.coll_id = :collId AND cp.product_id = p.id)`;

  const from = `
      FROM products p
      LEFT JOIN variants v
        ON v.company_id = p.company_id AND v.product_id = p.id AND v.is_default = 1`;

  const where = `
     WHERE p.company_id = :companyId
       AND p.deleted_at IS NULL
       AND (:activeOnly = 0 OR p.is_active = 1)
       ${membership}`;

  const order = isAuto
    ? 'p.created_at DESC, p.id DESC'
    : `(SELECT cp2.position FROM coll_prods cp2
          WHERE cp2.company_id = p.company_id AND cp2.coll_id = :collId AND cp2.product_id = p.id), p.id`;

  const binds = {
    companyId,
    activeOnly: activeOnly ? 1 : 0,
    ...(isAuto ? (ruleBinds ?? {}) : { collId }),
  };

  const rowsResult = await conn.execute(
    `SELECT p.id, p.name, p.slug, p.short_desc, p.brand, p.is_active, p.is_featured, p.tags,
            p.created_at,
            v.id AS variant_id, v.sku, v.price, v.sale_price, v.stock,
            img.media_id AS image_media_id, img.alt AS image_alt
       ${from}
       LEFT JOIN (
         SELECT company_id, product_id, media_id, alt,
                ROW_NUMBER() OVER (PARTITION BY company_id, product_id ORDER BY position, id) AS rn
           FROM prod_imgs
       ) img ON img.company_id = p.company_id AND img.product_id = p.id AND img.rn = 1
       ${where}
     ORDER BY ${order}
     OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...binds, offset, pageSize },
  );

  const countResult = await conn.execute(`SELECT COUNT(*) AS cnt ${from} ${where}`, binds);

  return { rows: rowsResult.rows, total: countResult.rows[0].CNT };
}

/** Products that exist in this company, used to validate a manual membership list. */
export async function filterOwnedProductIds(conn, { companyId, productIds }) {
  if (productIds.length === 0) return [];
  const binds = { companyId };
  const placeholders = productIds.map((productId, index) => {
    binds[`p${index}`] = productId;
    return `:p${index}`;
  });

  const result = await conn.execute(
    `SELECT id FROM products
      WHERE company_id = :companyId AND deleted_at IS NULL AND id IN (${placeholders.join(', ')})`,
    binds,
  );
  return result.rows.map((row) => row.ID);
}
