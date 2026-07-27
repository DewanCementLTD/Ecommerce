/**
 * JSON-in-CLOB columns (`products.tags`, `variants.opts`, `options.vals`,
 * `colls.rules`, later `sections.settings`) come back as strings because
 * pool.js sets `oracledb.fetchAsString = [oracledb.CLOB]`, and go in as strings
 * because the columns carry `CHECK (col IS JSON)`.
 */

/**
 * @template T
 * @param {string|null|undefined} value
 * @param {T} fallback returned when the column is null or somehow unparseable
 * @returns {T|any}
 */
export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    // The CHECK constraint makes this unreachable for rows written through the
    // API. Falling back beats throwing on a read path if one ever slips in.
    return fallback;
  }
}

/**
 * @param {any} value
 * @returns {string|null}
 */
export function stringifyJson(value) {
  return value === null || value === undefined ? null : JSON.stringify(value);
}
