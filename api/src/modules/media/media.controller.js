import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { uploadBodySchema, listQuerySchema, patchBodySchema } from './media.schema.js';
import * as mediaService from './media.service.js';
import { AppError } from '../../middleware/error.js';
import { MEDIA_WIDTHS, variantPath } from '../../lib/mediaStorage.js';

export async function postUpload(req, res, next) {
  try {
    if (!req.file) {
      throw new AppError(400, 'FILE_REQUIRED', 'An image file is required.');
    }
    const body = uploadBodySchema.parse(req.body);
    const media = await mediaService.uploadMedia({
      companyId: req.admin.companyId,
      buffer: req.file.buffer,
      originalFilename: req.file.originalname,
      alt: body.alt,
      folder: body.folder,
    });
    res.status(201).json({ media });
  } catch (err) {
    next(err);
  }
}

export async function getList(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    const result = await mediaService.listMedia({ companyId: req.admin.companyId, ...query });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const media = await mediaService.getMedia({ companyId: req.admin.companyId, id: Number(req.params.id) });
    res.json({ media });
  } catch (err) {
    next(err);
  }
}

export async function patchOne(req, res, next) {
  try {
    const body = patchBodySchema.parse(req.body);
    const media = await mediaService.patchMedia({
      companyId: req.admin.companyId,
      id: Number(req.params.id),
      ...body,
    });
    res.json({ media });
  } catch (err) {
    next(err);
  }
}

export async function deleteOne(req, res, next) {
  try {
    await mediaService.deleteMedia({ companyId: req.admin.companyId, id: Number(req.params.id) });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

export async function getFile(req, res, next) {
  try {
    const media = await mediaService.getMedia({ companyId: req.admin.companyId, id: Number(req.params.id) });
    const requestedWidth = req.query.width ? Number(req.query.width) : undefined;
    const width = MEDIA_WIDTHS.includes(requestedWidth)
      ? requestedWidth
      : (MEDIA_WIDTHS.filter((w) => w <= (media.WIDTH ?? w)).at(-1) ?? MEDIA_WIDTHS[0]);

    const filePath = variantPath(media.STORAGE_KEY, width);
    await stat(filePath);
    res.type('image/webp');
    createReadStream(filePath).pipe(res);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return next(new AppError(404, 'MEDIA_FILE_NOT_FOUND', 'That size was not generated for this image.'));
    }
    next(err);
  }
}
