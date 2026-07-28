/**
 * Platform-level lookups used to bootstrap tenant resolution, before any
 * company context exists. Callers must supply a connection borrowed via
 * withPlatform() — these queries are not company-scoped.
 */

export async function findCompanyIdByHost(conn, host) {
  const result = await conn.execute('SELECT company_id FROM domains WHERE host = :host', { host });
  return result.rows[0]?.COMPANY_ID ?? null;
}

export async function findCompanyById(conn, companyId) {
  const result = await conn.execute(
    `SELECT c.id, c.name, c.status, c.theme_id, c.currency, c.logo_media_id,
            c.email, c.phone,
            l.code AS default_lang, t.tokens AS theme_tokens,
            (SELECT MIN(d.host) FROM domains d
              WHERE d.company_id = c.id AND d.is_primary = 1) AS primary_host
     FROM companies c
     LEFT JOIN langs l ON l.company_id = c.id AND l.is_default = 1
     LEFT JOIN themes t ON t.id = c.theme_id
     WHERE c.id = :companyId`,
    { companyId },
  );
  return result.rows[0] ?? null;
}
