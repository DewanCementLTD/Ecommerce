import oracledb from 'oracledb';

const OUT_ID = { dir: oracledb.BIND_OUT, type: oracledb.NUMBER };

const PAGE_COLUMNS = `id, company_id, title, slug, type, content, is_active, meta_title, meta_desc,
                      og_image_id, created_at, updated_at`;
const SECTION_COLUMNS = `id, company_id, page_id, type, position, is_active, settings, created_at, updated_at`;
const BANNER_COLUMNS = `id, company_id, name, media_id, media_mobile_id, link, alt, position, is_active,
                        starts_at, ends_at, created_at, updated_at`;
const MENU_ITEM_COLUMNS = `id, company_id, menu_id, parent_id, label, url, link_type, link_id,
                           position, is_active`;

/* -------------------------------------------------------------------- pages */

export async function insertPage(conn, page) {
  const result = await conn.execute(
    `INSERT INTO pages (company_id, title, slug, type, content, is_active, meta_title, meta_desc, og_image_id)
     VALUES (:companyId, :title, :slug, :type, :content, :isActive, :metaTitle, :metaDesc, :ogImageId)
     RETURNING id INTO :id`,
    { ...page, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function listPages(conn, { companyId, isActive }) {
  const result = await conn.execute(
    `SELECT ${PAGE_COLUMNS} FROM pages
      WHERE company_id = :companyId
        AND (:isActive1 IS NULL OR is_active = :isActive2)
      ORDER BY DECODE(type, 'home', 0, 1), title`,
    { companyId, isActive1: isActive ?? null, isActive2: isActive ?? null },
  );
  return result.rows;
}

export async function findPageById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${PAGE_COLUMNS} FROM pages WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findPageBySlug(conn, { companyId, slug }) {
  const result = await conn.execute(
    `SELECT ${PAGE_COLUMNS} FROM pages WHERE slug = :slug AND company_id = :companyId`,
    { slug, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findHomePage(conn, { companyId }) {
  const result = await conn.execute(
    `SELECT ${PAGE_COLUMNS} FROM pages WHERE company_id = :companyId AND type = 'home'`,
    { companyId },
  );
  return result.rows[0] ?? null;
}

export async function findSlugsStartingWith(conn, { companyId, base, excludeId }) {
  const result = await conn.execute(
    `SELECT slug FROM pages
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

export async function updatePage(conn, page) {
  const result = await conn.execute(
    `UPDATE pages
        SET title = :title, slug = :slug, content = :content, is_active = :isActive,
            meta_title = :metaTitle, meta_desc = :metaDesc, og_image_id = :ogImageId,
            updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    page,
  );
  return result.rowsAffected > 0;
}

export async function deletePageById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM pages WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

/* ----------------------------------------------------------------- sections */

export async function listSections(conn, { companyId, pageId, isActive }) {
  const result = await conn.execute(
    `SELECT ${SECTION_COLUMNS} FROM sections
      WHERE company_id = :companyId AND page_id = :pageId
        AND (:isActive1 IS NULL OR is_active = :isActive2)
      ORDER BY position, id`,
    { companyId, pageId, isActive1: isActive ?? null, isActive2: isActive ?? null },
  );
  return result.rows;
}

export async function findSectionById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${SECTION_COLUMNS} FROM sections WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function insertSection(conn, { companyId, pageId, type, position, isActive, settings }) {
  const result = await conn.execute(
    `INSERT INTO sections (company_id, page_id, type, position, is_active, settings)
     VALUES (:companyId, :pageId, :type, :position, :isActive, :settings)
     RETURNING id INTO :id`,
    { companyId, pageId, type, position, isActive, settings, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function nextSectionPosition(conn, { companyId, pageId }) {
  const result = await conn.execute(
    `SELECT NVL(MAX(position), -1) + 1 AS next FROM sections
      WHERE company_id = :companyId AND page_id = :pageId`,
    { companyId, pageId },
  );
  return result.rows[0].NEXT;
}

export async function updateSection(conn, { companyId, id, isActive, settings }) {
  const result = await conn.execute(
    `UPDATE sections SET is_active = :isActive, settings = :settings, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    { id, companyId, isActive, settings },
  );
  return result.rowsAffected > 0;
}

export async function updateSectionPosition(conn, { companyId, pageId, id, position }) {
  const result = await conn.execute(
    `UPDATE sections SET position = :position, updated_at = SYSTIMESTAMP
      WHERE id = :id AND page_id = :pageId AND company_id = :companyId`,
    { id, pageId, companyId, position },
  );
  return result.rowsAffected > 0;
}

export async function deleteSectionById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM sections WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

export async function deleteSectionsByPage(conn, { companyId, pageId }) {
  const result = await conn.execute(
    'DELETE FROM sections WHERE company_id = :companyId AND page_id = :pageId',
    { companyId, pageId },
  );
  return result.rowsAffected;
}

/* ------------------------------------------------------------------ banners */

export async function insertBanner(conn, banner) {
  const result = await conn.execute(
    `INSERT INTO banners (company_id, name, media_id, media_mobile_id, link, alt, position, is_active,
                          starts_at, ends_at)
     VALUES (:companyId, :name, :mediaId, :mediaMobileId, :link, :alt, :position, :isActive,
             :startsAt, :endsAt)
     RETURNING id INTO :id`,
    { ...banner, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

/**
 * `liveOnly` applies the scheduling window: a banner is live when it is active
 * and SYSTIMESTAMP falls inside starts_at..ends_at, either end being open.
 */
export async function listBanners(conn, { companyId, isActive, liveOnly, ids }) {
  const binds = { companyId, isActive1: isActive ?? null, isActive2: isActive ?? null, liveOnly: liveOnly ? 1 : 0 };

  let idFilter = '';
  if (ids?.length) {
    const placeholders = ids.map((id, index) => {
      binds[`id${index}`] = id;
      return `:id${index}`;
    });
    idFilter = `AND id IN (${placeholders.join(', ')})`;
  }

  const result = await conn.execute(
    `SELECT ${BANNER_COLUMNS} FROM banners
      WHERE company_id = :companyId
        AND (:isActive1 IS NULL OR is_active = :isActive2)
        AND (:liveOnly = 0 OR (is_active = 1
             AND (starts_at IS NULL OR starts_at <= SYSTIMESTAMP)
             AND (ends_at IS NULL OR ends_at > SYSTIMESTAMP)))
        ${idFilter}
      ORDER BY position, id`,
    binds,
  );
  return result.rows;
}

export async function findBannerById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${BANNER_COLUMNS} FROM banners WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function updateBanner(conn, banner) {
  const result = await conn.execute(
    `UPDATE banners
        SET name = :name, media_id = :mediaId, media_mobile_id = :mediaMobileId, link = :link,
            alt = :alt, position = :position, is_active = :isActive, starts_at = :startsAt,
            ends_at = :endsAt, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    banner,
  );
  return result.rowsAffected > 0;
}

export async function deleteBannerById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM banners WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

/* -------------------------------------------------------------------- menus */

export async function insertMenu(conn, { companyId, code, name }) {
  const result = await conn.execute(
    `INSERT INTO menus (company_id, code, name) VALUES (:companyId, :code, :name)
     RETURNING id INTO :id`,
    { companyId, code, name, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function listMenus(conn, { companyId }) {
  const result = await conn.execute(
    'SELECT id, company_id, code, name FROM menus WHERE company_id = :companyId ORDER BY code',
    { companyId },
  );
  return result.rows;
}

export async function findMenuById(conn, { companyId, id }) {
  const result = await conn.execute(
    'SELECT id, company_id, code, name FROM menus WHERE id = :id AND company_id = :companyId',
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function findMenuByCode(conn, { companyId, code }) {
  const result = await conn.execute(
    'SELECT id, company_id, code, name FROM menus WHERE code = :code AND company_id = :companyId',
    { code, companyId },
  );
  return result.rows[0] ?? null;
}

export async function updateMenu(conn, { companyId, id, name }) {
  const result = await conn.execute(
    'UPDATE menus SET name = :name, updated_at = SYSTIMESTAMP WHERE id = :id AND company_id = :companyId',
    { id, companyId, name },
  );
  return result.rowsAffected > 0;
}

/* --------------------------------------------------------------- menu items */

export async function listMenuItems(conn, { companyId, menuId, isActive }) {
  const result = await conn.execute(
    `SELECT ${MENU_ITEM_COLUMNS} FROM menu_items
      WHERE company_id = :companyId AND menu_id = :menuId
        AND (:isActive1 IS NULL OR is_active = :isActive2)
      ORDER BY position, id`,
    { companyId, menuId, isActive1: isActive ?? null, isActive2: isActive ?? null },
  );
  return result.rows;
}

export async function findMenuItemById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT ${MENU_ITEM_COLUMNS} FROM menu_items WHERE id = :id AND company_id = :companyId`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function insertMenuItem(conn, item) {
  const result = await conn.execute(
    `INSERT INTO menu_items (company_id, menu_id, parent_id, label, url, link_type, link_id, position, is_active)
     VALUES (:companyId, :menuId, :parentId, :label, :url, :linkType, :linkId, :position, :isActive)
     RETURNING id INTO :id`,
    { ...item, id: OUT_ID },
  );
  return result.outBinds.id[0];
}

export async function updateMenuItem(conn, item) {
  const result = await conn.execute(
    `UPDATE menu_items
        SET parent_id = :parentId, label = :label, url = :url, link_type = :linkType,
            link_id = :linkId, position = :position, is_active = :isActive, updated_at = SYSTIMESTAMP
      WHERE id = :id AND company_id = :companyId`,
    item,
  );
  return result.rowsAffected > 0;
}

export async function deleteMenuItemById(conn, { companyId, id }) {
  const result = await conn.execute('DELETE FROM menu_items WHERE id = :id AND company_id = :companyId', {
    id,
    companyId,
  });
  return result.rowsAffected > 0;
}

export async function listMenuItemParentPairs(conn, { companyId, menuId }) {
  const result = await conn.execute(
    'SELECT id, parent_id FROM menu_items WHERE company_id = :companyId AND menu_id = :menuId',
    { companyId, menuId },
  );
  return result.rows;
}

export async function countMenuItemChildren(conn, { companyId, id }) {
  const result = await conn.execute(
    'SELECT COUNT(*) AS cnt FROM menu_items WHERE company_id = :companyId AND parent_id = :id',
    { companyId, id },
  );
  return result.rows[0].CNT;
}
