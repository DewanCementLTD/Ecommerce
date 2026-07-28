import { Router } from 'express';
import * as controller from './staff.controller.js';

export const adminsRouter = Router();
adminsRouter.get('/', controller.getAdmins);
adminsRouter.post('/', controller.postAdmin);
adminsRouter.patch('/:id', controller.patchAdmin);
adminsRouter.delete('/:id', controller.deleteAdmin);

export const rolesRouter = Router();
rolesRouter.get('/', controller.getRoles);
rolesRouter.post('/', controller.postRole);
rolesRouter.patch('/:id', controller.patchRole);
rolesRouter.delete('/:id', controller.deleteRole);
