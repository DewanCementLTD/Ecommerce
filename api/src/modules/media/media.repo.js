export async function insertMedia(conn, { companyId, filename, alt, mime, sizeBytes, width, height, folder, storageKey }) {
  await conn.execute(
    `INSERT INTO media (company_id, filename, alt, mime, size_bytes, width, height, folder, storage_key)
     VALUES (:companyId, :filename, :alt, :mime, :sizeBytes, :width, :height, :folder, :storageKey)`,
    { companyId, filename, alt, mime, sizeBytes, width, height, folder, storageKey },
  );
  const result = await conn.execute('SELECT id FROM media WHERE storage_key = :storageKey', { storageKey });
  return result.rows[0].ID;
}

export async function listMedia(conn, { companyId, page, pageSize, search, folder }) {
  const offset = (page - 1) * pageSize;
  const searchPattern = search ? `%${search.toLowerCase()}%` : null;
  const folderValue = folder ?? null;

  const filterSql = `company_id = :companyId
       AND deleted_at IS NULL
       AND (:search1 IS NULL OR LOWER(filename) LIKE :search2 OR LOWER(alt) LIKE :search3)
       AND (:folder1 IS NULL OR folder = :folder2)`;
  const filterBinds = {
    companyId,
    search1: searchPattern,
    search2: searchPattern,
    search3: searchPattern,
    folder1: folderValue,
    folder2: folderValue,
  };

  const rowsResult = await conn.execute(
    `SELECT id, filename, alt, mime, size_bytes, width, height, folder, storage_key, created_at
     FROM media
     WHERE ${filterSql}
     ORDER BY created_at DESC
     OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY`,
    { ...filterBinds, offset, pageSize },
  );

  const countResult = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM media WHERE ${filterSql}`,
    filterBinds,
  );

  return { rows: rowsResult.rows, total: countResult.rows[0].CNT };
}

export async function findMediaById(conn, { companyId, id }) {
  const result = await conn.execute(
    `SELECT id, company_id, filename, alt, mime, size_bytes, width, height, folder, storage_key, created_at
     FROM media WHERE id = :id AND company_id = :companyId AND deleted_at IS NULL`,
    { id, companyId },
  );
  return result.rows[0] ?? null;
}

export async function updateMedia(conn, { companyId, id, alt, folder }) {
  await conn.execute(
    `UPDATE media SET alt = :alt, folder = :folder
     WHERE id = :id AND company_id = :companyId AND deleted_at IS NULL`,
    { id, companyId, alt, folder },
  );
  return findMediaById(conn, { companyId, id });
}

export async function softDeleteMedia(conn, { companyId, id }) {
  const result = await conn.execute(
    `UPDATE media SET deleted_at = SYSTIMESTAMP
     WHERE id = :id AND company_id = :companyId AND deleted_at IS NULL`,
    { id, companyId },
  );
  return result.rowsAffected > 0;
}
