import { Router } from 'express';
import * as controller from './customers.controller.js';
import { requireCustomerAuth } from '../../middleware/customerAuth.js';

/** Public, mounted at /shop/account behind tenantResolver only. */
export const accountRouter = Router();

accountRouter.post('/register', controller.postRegister);
accountRouter.post('/login', controller.postLogin);
accountRouter.post('/refresh', controller.postRefresh);
accountRouter.post('/logout', requireCustomerAuth, controller.postLogout);
accountRouter.get('/me', requireCustomerAuth, controller.getMe);
accountRouter.patch('/me', requireCustomerAuth, controller.patchMe);

accountRouter.get('/addresses', requireCustomerAuth, controller.getAddrs);
accountRouter.post('/addresses', requireCustomerAuth, controller.postAddr);
accountRouter.patch('/addresses/:id', requireCustomerAuth, controller.patchAddr);
accountRouter.delete('/addresses/:id', requireCustomerAuth, controller.deleteAddr);

/** Admin-facing, mounted at /customers behind requireAuth + requireCompany. */
export const customersRouter = Router();

customersRouter.get('/', controller.getList);
customersRouter.get('/:id', controller.getOne);
customersRouter.patch('/:id', controller.patchOne);
