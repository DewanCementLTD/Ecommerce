import { Router } from 'express';
import { postLogin, postRefresh, postLogout, getMe } from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.js';

export const authRouter = Router();

authRouter.post('/login', postLogin);
authRouter.post('/refresh', postRefresh);
authRouter.post('/logout', requireAuth, postLogout);
authRouter.get('/me', requireAuth, getMe);
