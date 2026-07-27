import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { logger } from './lib/logger.js';
import { reqId } from './middleware/reqId.js';
import { errorHandler } from './middleware/error.js';
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

export function createApp() {
  const app = express();

  app.use(reqId);
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp({ logger, genReqId: (req) => req.id }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/storefront', tenantResolver, storefrontRouter);
  app.use('/shop', tenantResolver, shopRouter);
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
  app.use('/platform', requireAuth, requireRole('platform'), platformRouter);

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });

  app.use(errorHandler);

  return app;
}
