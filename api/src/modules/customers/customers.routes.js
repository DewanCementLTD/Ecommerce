import { Router } from 'express';
import * as controller from './customers.controller.js';
import { requireCustomerAuth } from '../../middleware/customerAuth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { companyKey } from '../../lib/cache.js';

/**
 * Company-scoped: one store being hammered must not lock shoppers out of a
 * different store that happens to share an IP (a corporate NAT, a mobile
 * carrier). Register is limited as well as login — an unlimited register
 * endpoint is a free way to fill a client's customer list with noise.
 */
const accountRateLimit = rateLimit({
  keyFn: (req) => companyKey(req.companyId, 'account', 'attempt', req.ip),
  limit: 20,
  windowSeconds: 15 * 60,
});

/** Public, mounted at /shop/account behind tenantResolver only. */
export const accountRouter = Router();

accountRouter.post('/register', accountRateLimit, controller.postRegister);
accountRouter.post('/login', accountRateLimit, controller.postLogin);
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
