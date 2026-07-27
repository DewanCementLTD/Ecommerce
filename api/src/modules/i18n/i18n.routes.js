import { Router } from 'express';
import * as controller from './i18n.controller.js';

export const langsRouter = Router();
langsRouter.get('/', controller.getLangs);
langsRouter.post('/', controller.postLang);
langsRouter.patch('/:id', controller.patchLang);
langsRouter.delete('/:id', controller.deleteLang);

export const transRouter = Router();
transRouter.get('/:entity/:id', controller.getTranslations);
transRouter.put('/:entity/:id', controller.putTranslations);
