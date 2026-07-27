/**
 * oracledb returns column names exactly as Oracle stores them — upper case,
 * snake case (`META_TITLE`). Phase 1's modules map rows to camelCase before they
 * leave the service layer so the storefront and admin consume normal JSON.
 *
 * Phase 0's endpoints (`/media`, `/platform`, `/auth`) keep returning raw rows:
 * the Super Admin SPA already reads `row.NAME`, and changing that shape would
 * break a shipped UI for no benefit. See docs/DECISIONS.md.
 *
 * Values are passed through untouched. NUMBER(1) booleans stay 0/1 rather than
 * being guessed into true/false — the column list, not this helper, is the
 * authority on what a column means.
 */

const camelCache = new Map();

function toCamelKey(key) {
  let cached = camelCache.get(key);
  if (cached) return cached;
  cached = key.toLowerCase().replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
  camelCache.set(key, cached);
  return cached;
}

/**
 * @param {Record<string, any>|null|undefined} row
 * @returns {Record<string, any>|null}
 */
export function camelRow(row) {
  if (!row) return null;
  const mapped = {};
  for (const [key, value] of Object.entries(row)) {
    mapped[toCamelKey(key)] = value;
  }
  return mapped;
}

/**
 * @param {Record<string, any>[]} rows
 * @returns {Record<string, any>[]}
 */
export function camelRows(rows) {
  return (rows ?? []).map((row) => camelRow(row));
}
