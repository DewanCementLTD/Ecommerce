import * as ordersService from '../orders/orders.service.js';
import * as productsService from '../products/products.service.js';
import * as settingsService from '../settings/settings.service.js';

const DEFAULT_LOW_STOCK_THRESHOLD = 5;

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function periodWithDelta({ companyId, days }) {
  const [current, previous] = await Promise.all([
    ordersService.getStatsForPeriod({ companyId, from: daysAgo(days) }),
    ordersService.getStatsForPeriod({ companyId, from: daysAgo(days * 2) }),
  ]);
  // "previous" as fetched covers the last 2*days; subtract the current window
  // to get the window immediately before it, so the delta compares like periods.
  const priorOnly = {
    orderCount: previous.orderCount - current.orderCount,
    revenue: previous.revenue - current.revenue,
  };
  return {
    orderCount: current.orderCount,
    revenue: round2(current.revenue),
    priorOrderCount: priorOnly.orderCount,
    priorRevenue: round2(priorOnly.revenue),
  };
}

/**
 * Four questions a shop owner actually asks (docs/03-PHASE-2-orders.md Task 5),
 * every number computed in SQL — nothing here loops over rows in JS to sum.
 */
export async function getSummary({ companyId }) {
  const settings = await settingsService.getSettings({ companyId });
  const threshold = Number(settings.settings.low_stock_threshold) || DEFAULT_LOW_STOCK_THRESHOLD;

  const [today, last7, last30, awaitingConfirmation, stockAlerts, topProducts, revenueSeries] = await Promise.all([
    periodWithDelta({ companyId, days: 1 }),
    periodWithDelta({ companyId, days: 7 }),
    periodWithDelta({ companyId, days: 30 }),
    ordersService.getAwaitingConfirmationCount({ companyId }),
    productsService.getStockAlerts({ companyId, threshold }),
    ordersService.getTopProducts({ companyId, from: daysAgo(30), limit: 10 }),
    ordersService.getRevenueByDay({ companyId, from: daysAgo(30) }),
  ]);

  return {
    today,
    last7Days: last7,
    last30Days: last30,
    awaitingConfirmation,
    lowStock: stockAlerts.lowStock,
    outOfStockCount: stockAlerts.outOfStockCount,
    topProducts,
    revenueSeries,
  };
}
