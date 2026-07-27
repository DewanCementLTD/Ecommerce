import { Router } from 'express';
import {
  postCompany,
  getCompanies,
  getCompany,
  patchCompany,
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
platformRouter.post('/companies/:id/suspend', postSuspend);
platformRouter.post('/companies/:id/activate', postActivate);
platformRouter.post('/companies/:id/domains', postDomain);
platformRouter.delete('/domains/:id', deleteDomain);
platformRouter.post('/companies/:id/impersonate', postImpersonate);
