import { Router } from 'express';
import {
  postCompany,
  getCompanies,
  getCompany,
  patchCompany,
  getCompanyDomains,
  getCompanySettings,
  postSuspend,
  postActivate,
  postDomain,
  deleteDomain,
  postImpersonate,
  getLogs,
} from './platform.controller.js';

export const platformRouter = Router();

platformRouter.get('/logs', getLogs);
platformRouter.post('/companies', postCompany);
platformRouter.get('/companies', getCompanies);
platformRouter.get('/companies/:id', getCompany);
platformRouter.patch('/companies/:id', patchCompany);
platformRouter.get('/companies/:id/domains', getCompanyDomains);
platformRouter.get('/companies/:id/settings', getCompanySettings);
platformRouter.post('/companies/:id/suspend', postSuspend);
platformRouter.post('/companies/:id/activate', postActivate);
platformRouter.post('/companies/:id/domains', postDomain);
platformRouter.delete('/domains/:id', deleteDomain);
platformRouter.post('/companies/:id/impersonate', postImpersonate);
