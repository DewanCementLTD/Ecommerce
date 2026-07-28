import { Router } from 'express';
import multer from 'multer';
import { postUpload, getList, getOne, patchOne, deleteOne, getFile } from './media.controller.js';

import { rateLimit } from '../../middleware/rateLimit.js';
import { companyKey } from '../../lib/cache.js';

/**
 * `limits` is checked by multer while it reads the stream, so an oversized
 * body is rejected before it is buffered — not after. `files: 1` matters as
 * much as the size cap: without it, one request could carry a hundred
 * 10MB parts and still be "within the limit" for each.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 10 },
});

/**
 * Uploads are the most expensive authenticated endpoint in the system: each
 * one re-encodes an image into eight files (four widths, two formats). A
 * compromised or careless staff token should not be able to turn that into a
 * way to fill the disk or pin the CPU.
 */
const uploadRateLimit = rateLimit({
  keyFn: (req) => companyKey(req.admin.companyId, 'media', 'upload', req.ip),
  limit: 60,
  windowSeconds: 60 * 10,
});

export const mediaRouter = Router();

mediaRouter.post('/', uploadRateLimit, upload.single('file'), postUpload);
mediaRouter.get('/', getList);
mediaRouter.get('/:id/file', getFile);
mediaRouter.get('/:id', getOne);
mediaRouter.patch('/:id', patchOne);
mediaRouter.delete('/:id', deleteOne);
