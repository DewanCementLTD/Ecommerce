import { Router } from 'express';
import { getCompanyInfo, getPublicMediaFile } from './storefront.controller.js';

export const storefrontRouter = Router();

storefrontRouter.get('/company', getCompanyInfo);
storefrontRouter.get('/media/:id/file', getPublicMediaFile);
