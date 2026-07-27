/**
 * Deletes everything a company owns, child rows first.
 *
 * Provisioning now creates pages, sections, categories and menus (steps 6-9 of
 * 00-SYSTEM-DESIGN.md §6), so any suite that provisions a company has a much
 * larger graph to tear down than it used to. Keeping the order in one place
 * means a new table is added here once rather than in every test file — the
 * kind of drift that shows up later as a confusing ORA-02292 in an unrelated
 * suite's teardown.
 *
 * Must run on a `withPlatform` connection: it spans companies and deletes rows
 * a company-scoped connection could not see.
 */

/** Child-before-parent. Self-referencing tables appear twice, children first. */
const DELETE_ORDER = [
  'DELETE FROM coll_prods WHERE company_id = :id',
  'DELETE FROM prod_cats WHERE company_id = :id',
  'DELETE FROM prod_imgs WHERE company_id = :id',
  'DELETE FROM options WHERE company_id = :id',
  'DELETE FROM variants WHERE company_id = :id',
  'DELETE FROM colls WHERE company_id = :id',
  'DELETE FROM products WHERE company_id = :id',
  'DELETE FROM menu_items WHERE company_id = :id AND parent_id IS NOT NULL',
  'DELETE FROM menu_items WHERE company_id = :id',
  'DELETE FROM menus WHERE company_id = :id',
  'DELETE FROM banners WHERE company_id = :id',
  'DELETE FROM sections WHERE company_id = :id',
  'DELETE FROM pages WHERE company_id = :id',
  'DELETE FROM cats WHERE company_id = :id AND parent_id IS NOT NULL',
  'DELETE FROM cats WHERE company_id = :id',
  'DELETE FROM media WHERE company_id = :id',
  'DELETE FROM logs WHERE company_id = :id',
  'DELETE FROM settings WHERE company_id = :id',
  'DELETE FROM langs WHERE company_id = :id',
  'DELETE FROM admins WHERE company_id = :id',
  'DELETE FROM domains WHERE company_id = :id',
  'DELETE FROM companies WHERE id = :id',
];

/**
 * @param {import('oracledb').Connection} conn a withPlatform connection
 * @param {number[]} companyIds
 */
export async function deleteCompanies(conn, companyIds) {
  for (const id of companyIds.filter(Boolean)) {
    for (const sql of DELETE_ORDER) {
      await conn.execute(sql, { id });
    }
  }
  await conn.commit();
}
