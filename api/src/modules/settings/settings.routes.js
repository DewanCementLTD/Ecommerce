import { Router } from 'express';
import * as controller from './settings.controller.js';

export const settingsRouter = Router();

settingsRouter.get('/', controller.getSettings);
settingsRouter.put('/', controller.putSettings);
