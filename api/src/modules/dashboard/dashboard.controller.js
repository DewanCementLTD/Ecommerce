import * as dashboardService from './dashboard.service.js';

export async function getSummary(req, res, next) {
  try {
    res.json(await dashboardService.getSummary({ companyId: req.admin.companyId }));
  } catch (err) {
    next(err);
  }
}
