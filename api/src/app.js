import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger.js';
import { reqId } from './middleware/reqId.js';
import { errorHandler } from './middleware/error.js';
import { cacheBust } from './middleware/cache.js';
import { metrics } from './middleware/metrics.js';
import { healthRouter } from './modules/health/health.routes.js';
import { corsMiddleware } from './middleware/cors.js';
import { tenantResolver } from './middleware/tenant.js';
import { storefrontRouter } from './modules/storefront/storefront.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { requireAuth, requireRole } from './middleware/auth.js';
import { requireCompany } from './middleware/company.js';
import { mediaRouter } from './modules/media/media.routes.js';
import { platformRouter } from './modules/platform/platform.routes.js';
import { catsRouter } from './modules/cats/cats.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { collsRouter } from './modules/colls/colls.routes.js';
import { shopRouter } from './modules/shop/shop.routes.js';
import {
  pagesRouter,
  sectionsRouter,
  bannersRouter,
  menusRouter,
  menuItemsRouter,
} from './modules/content/content.routes.js';
import { langsRouter, transRouter } from './modules/i18n/i18n.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { adminsRouter, rolesRouter } from './modules/staff/staff.routes.js';
import { accountRouter, customersRouter } from './modules/customers/customers.routes.js';
import { cartRouter } from './modules/carts/carts.routes.js';
import { checkoutRouter, myOrdersRouter, ordersRouter } from './modules/orders/orders.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { optionalCustomerAuth } from './middleware/customerAuth.js';

export function createApp() {
  const app = express();

  app.use(reqId);
  app.use(
    helmet({
      /*
       * HSTS for a year, including subdomains. Every client store is a
       * separate domain pointed at this one server, so a downgrade attack on
       * any of them is a downgrade attack on the platform.
       */
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      /*
       * This API serves JSON and image bytes, never HTML, so the default CSP
       * is already as strict as it needs to be — but `frame-ancestors` is
       * tightened to 'none': no page anywhere should be framing an API
       * response.
       */
      contentSecurityPolicy: {
        useDefaults: true,
        directives: { 'frame-ancestors': ["'none'"] },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(corsMiddleware());
  app.use(express.json());
  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));
  // Registered before the routes so its `finish` listener is attached before
  // any handler can send a response.
  app.use(cacheBust);
  app.use(metrics);

  app.use(healthRouter);

  app.use('/storefront', tenantResolver, storefrontRouter);
  app.use('/shop', tenantResolver, shopRouter);
  // More specific /shop/account/orders mounted before the general /shop/account,
  // so it's never shadowed by accountRouter falling through on an unmatched path.
  app.use('/shop/account/orders', tenantResolver, myOrdersRouter);
  app.use('/shop/account', tenantResolver, accountRouter);
  app.use('/shop/cart', tenantResolver, optionalCustomerAuth, cartRouter);
  app.use('/shop/checkout', tenantResolver, optionalCustomerAuth, checkoutRouter);
  app.use('/orders', requireAuth, requireCompany, ordersRouter);
  app.use('/dashboard', requireAuth, requireCompany, dashboardRouter);
  app.use('/customers', requireAuth, requireCompany, customersRouter);
  app.use('/auth', authRouter);
  app.use('/media', requireAuth, requireCompany, mediaRouter);
  app.use('/cats', requireAuth, requireCompany, catsRouter);
  app.use('/products', requireAuth, requireCompany, productsRouter);
  app.use('/colls', requireAuth, requireCompany, collsRouter);
  app.use('/pages', requireAuth, requireCompany, pagesRouter);
  app.use('/sections', requireAuth, requireCompany, sectionsRouter);
  app.use('/banners', requireAuth, requireCompany, bannersRouter);
  app.use('/menus', requireAuth, requireCompany, menusRouter);
  app.use('/menu-items', requireAuth, requireCompany, menuItemsRouter);
  app.use('/langs', requireAuth, requireCompany, langsRouter);
  app.use('/trans', requireAuth, requireCompany, transRouter);
  app.use('/settings', requireAuth, requireCompany, settingsRouter);
  app.use('/admins', requireAuth, requireCompany, adminsRouter);
  app.use('/roles', requireAuth, requireCompany, rolesRouter);
  app.use('/platform', requireAuth, requireRole('platform'), platformRouter);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.use(errorHandler);

  return app;
}
