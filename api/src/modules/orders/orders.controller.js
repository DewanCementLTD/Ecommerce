import {
  idParamSchema,
  checkoutSchema,
  statusPatchSchema,
  orderPatchSchema,
  listQuerySchema,
  exportQuerySchema,
} from './orders.schema.js';
import * as ordersService from './orders.service.js';

/* ----------------------------------------------------------------- public */

export async function postCheckout(req, res, next) {
  try {
    const body = checkoutSchema.parse(req.body);
    const idempotencyKey = req.headers['idempotency-key'];
    const order = await ordersService.checkout({
      companyId: req.companyId,
      company: req.company,
      customerId: req.customer?.id,
      cartToken: req.headers['x-cart-token'],
      idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
      lang: req.query.lang,
      ...body,
    });
    res.status(201).json({ order });
  } catch (err) {
    next(err);
  }
}

export async function getMyOrders(req, res, next) {
  try {
    const query = listQuerySchema.pick({ page: true, pageSize: true }).parse(req.query);
    res.json(await ordersService.listMyOrders({ companyId: req.companyId, customerId: req.customer.id, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getMyOrder(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const order = await ordersService.getOrder({ companyId: req.companyId, id });
    if (order.customerId !== req.customer.id) {
      // Same response as "doesn't exist" — a customer must not learn that a
      // given order id belongs to someone else in this store.
      return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Order not found.' } });
    }
    res.json({ order });
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------------ admin */

export async function getList(req, res, next) {
  try {
    const query = listQuerySchema.parse(req.query);
    res.json(await ordersService.listOrders({ companyId: req.admin.companyId, ...query }));
  } catch (err) {
    next(err);
  }
}

export async function getExport(req, res, next) {
  try {
    const query = exportQuerySchema.parse(req.query);
    const rows = await ordersService.listOrdersForExport({ companyId: req.admin.companyId, ...query });

    const header = ['Order #', 'Status', 'Name', 'Phone', 'Email', 'Total', 'Currency', 'Placed at'];
    const csvLines = [header.join(',')];
    for (const row of rows) {
      csvLines.push(
        [row.orderNo, row.status, row.name, row.phone, row.email ?? '', row.total, row.currency ?? '', row.placedAt]
          .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(','),
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    res.send(csvLines.join('\n'));
  } catch (err) {
    next(err);
  }
}

export async function getOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json({ order: await ordersService.getOrder({ companyId: req.admin.companyId, id }) });
  } catch (err) {
    next(err);
  }
}

export async function patchStatus(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = statusPatchSchema.parse(req.body);
    res.json({
      order: await ordersService.updateStatus({
        companyId: req.admin.companyId,
        id,
        actorAdminId: req.admin.id,
        ...body,
      }),
    });
  } catch (err) {
    next(err);
  }
}

export async function patchOne(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const body = orderPatchSchema.parse(req.body);
    res.json({ order: await ordersService.patchOrder({ companyId: req.admin.companyId, id, ...body }) });
  } catch (err) {
    next(err);
  }
}
