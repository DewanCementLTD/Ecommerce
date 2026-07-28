import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';
import { captureError } from '../lib/errorTracker.js';

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  (req.log ?? logger).error({ err }, 'request failed');

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request.', issues: err.issues },
    });
  }

  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'Images must be 10MB or smaller.' : err.message;
    return res.status(400).json({ error: { code: `UPLOAD_${err.code}`, message } });
  }

  const isAppError = err instanceof AppError;
  const status = isAppError ? err.status : 500;

  /*
   * Only unexpected failures are reported. An AppError is this application
   * saying "no" on purpose — a 404 for a slug that does not exist, a 409 for
   * a duplicate domain — and paging someone for those trains everyone to
   * ignore the alerts that matter.
   */
  if (!isAppError) {
    captureError(err, {
      reqId: req.id,
      companyId: req.companyId ?? req.admin?.companyId ?? null,
      route: `${req.method} ${req.baseUrl ?? ''}${req.route?.path ?? req.path}`,
      status,
    });
  }

  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'Internal server error';

  res.status(status).json({ error: { code, message } });
}
