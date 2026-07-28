import { Router } from 'express';
import * as controller from './orders.controller.js';
import { requireCustomerAuth } from '../../middleware/customerAuth.js';
import { rateLimit } from '../../middleware/rateLimit.js';

const checkoutRateLimit = rateLimit({
  keyFn: (req) => `checkout:attempt:${req.companyId}:${req.ip}`,
  limit: 10,
  windowSeconds: 15 * 60,
});

/** Public, mounted at /shop/checkout behind tenantResolver + optionalCustomerAuth. */
export const checkoutRouter = Router();
checkoutRouter.post('/', checkoutRateLimit, controller.postCheckout);

/** Customer-facing, mounted at /shop/account/orders behind tenantResolver + requireCustomerAuth. */
export const myOrdersRouter = Router();
myOrdersRouter.get('/', requireCustomerAuth, controller.getMyOrders);
myOrdersRouter.get('/:id', requireCustomerAuth, controller.getMyOrder);

/** Admin-facing, mounted at /orders behind requireAuth + requireCompany. */
export const ordersRouter = Router();
ordersRouter.get('/export', controller.getExport);
ordersRouter.get('/', controller.getList);
ordersRouter.get('/:id', controller.getOne);
ordersRouter.patch('/:id/status', controller.patchStatus);
ordersRouter.patch('/:id', controller.patchOne);
