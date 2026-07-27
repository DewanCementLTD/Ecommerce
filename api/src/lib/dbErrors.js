/**
 * Oracle error numbers the repositories deliberately let bubble up, so a service
 * can translate a constraint the database already enforces into an HTTP response
 * instead of re-checking it with an extra query.
 *
 * This is how cross-company parent references are reported: the composite FKs in
 * 003_catalog.sql make them impossible, and ORA-02291 is what that looks like
 * from Node.
 */
export const ORA_UNIQUE_VIOLATION = 1;
export const ORA_CHECK_VIOLATION = 2290;
export const ORA_FK_VIOLATION = 2291;
export const ORA_VPD_CHECK_VIOLATION = 28115;

/**
 * @param {unknown} err
 * @param {string} [constraintName] narrow the match to one named constraint
 * @returns {boolean}
 */
export function isForeignKeyViolation(err, constraintName) {
  if (err?.errorNum !== ORA_FK_VIOLATION) return false;
  if (!constraintName) return true;
  return String(err.message).toUpperCase().includes(constraintName.toUpperCase());
}

/**
 * @param {unknown} err
 * @param {string} [constraintName]
 * @returns {boolean}
 */
export function isUniqueViolation(err, constraintName) {
  if (err?.errorNum !== ORA_UNIQUE_VIOLATION) return false;
  if (!constraintName) return true;
  return String(err.message).toUpperCase().includes(constraintName.toUpperCase());
}
