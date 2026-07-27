import { AppError } from './error.js';

/**
 * Company-owned routes need a company to scope to. A platform admin's token
 * carries `company_id: null`, which would otherwise reach `withCompany(null)`
 * and surface as a 500 — this turns it into an honest 403. Platform admins get
 * at a company's data by impersonating it (`POST /platform/companies/:id/impersonate`),
 * which mints a token that does carry a company_id.
 */
export function requireCompany(req, res, next) {
  if (req.admin?.companyId == null) {
    return next(
      new AppError(
        403,
        'COMPANY_REQUIRED',
        'This endpoint belongs to a store. Platform admins must impersonate a company first.',
      ),
    );
  }
  next();
}
