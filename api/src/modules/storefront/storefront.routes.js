import { Router } from 'express';
import { getCompanyInfo } from './storefront.controller.js';

export const storefrontRouter = Router();

storefrontRouter.get('/company', getCompanyInfo);
