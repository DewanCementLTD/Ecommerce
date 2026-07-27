import { Router } from 'express';
import multer from 'multer';
import { postUpload, getList, getOne, patchOne, deleteOne, getFile } from './media.controller.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const mediaRouter = Router();

mediaRouter.post('/', upload.single('file'), postUpload);
mediaRouter.get('/', getList);
mediaRouter.get('/:id/file', getFile);
mediaRouter.get('/:id', getOne);
mediaRouter.patch('/:id', patchOne);
mediaRouter.delete('/:id', deleteOne);
