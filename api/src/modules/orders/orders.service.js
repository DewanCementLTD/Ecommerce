import { withCompany, withPlatform } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import { camelRow, camelRows } from '../../lib/rows.js';
import { parseJson, stringifyJson } from '../../lib/json.js';
import { getRedis } from '../../lib/redis.js';
import { findCompanyById } from '../tenants/tenants.repo.js';
import * as repo from './orders.repo.js';
import * as cartsService from '../carts/carts.service.js';
import * as customersService from '../customers/customers.service.js';
import * as productsService from '../products/products.service.js';
import { sendOrderConfirmation, sendOrderStatusChanged, sendAdminNewOrderNotice } from '../mail/mail.service.js';

/**
 * Admin-triggered actions (status changes) don't arrive via tenantResolver,
 * so there's no req.company to reuse for branding an email — this rebuilds
 * the same shape tenant.js does, from the same repo function.
 */
async function loadCompanyForEmail(companyId) {
  const row = await withPlatform((conn) => findCompanyById(conn, companyId));
  if (!row) return null;
  return {
    id: row.ID,
    name: row.NAME,
    currency: row.CURRENCY,
    email: row.EMAIL,
    phone: row.PHONE,
    theme: row.THEME_TOKENS ? JSON.parse(row.THEME_TOKENS) : null,
    logoMediaId: row.LOGO_MEDIA_ID,
  };
}

const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** `new` and `confirmed` are always cancellable; nothing is reachable from a terminal state. */
const STATUS_TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

function round2(n) {
  return Math.round(n * 100) / 100;
}

function toOrderDto(row) {
  const order = camelRow(row);
  if (!order) return null;
  order.address = parseJson(order.address, null);
  return order;
}

function toOrderItemDto(row) {
  const item = camelRow(row);
  item.optsSnap = parseJson(item.optsSnap, {});
  return item;
}

async function assembleOrder({ companyId, id }) {
  const [order, items, log] = await withCompany(companyId, async (conn) => [
    await repo.findOrderById(conn, { companyId, id }),
    await repo.listOrderItems(conn, { companyId, orderId: id }),
    await repo.listOrderLog(conn, { companyId, orderId: id }),
  ]);
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  return { ...toOrderDto(order), items: items.map(toOrderItemDto), log: camelRows(log) };
}

export async function getOrder({ companyId, id }) {
  return assembleOrder({ companyId, id });
}

/* ----------------------------------------------------------------- checkout */

export async function checkout({ companyId, company, customerId, cartToken, idempotencyKey, name, phone, email, note, addrId, address, lang }) {
  const redis = getRedis();
  const idemKey = idempotencyKey ? `checkout:idem:${companyId}:${idempotencyKey}` : null;
  if (idemKey) {
    const existingOrderId = await redis.get(idemKey);
    if (existingOrderId) return getOrder({ companyId, id: Number(existingOrderId) });
  }

  // Fail fast, before opening a transaction, on the common cases: empty cart,
  // a line that's already unavailable. The authoritative check is still the
  // conditional stock decrement inside the transaction below.
  const preview = await cartsService.loadCartForCheckout({ companyId, token: cartToken });
  if (preview.items.length === 0) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty.');
  for (const item of preview.items) {
    if (!item.available) {
      throw new AppError(409, 'PRODUCT_UNAVAILABLE', `${item.product?.name ?? 'An item'} in your cart is no longer available.`);
    }
    if (!item.inStock) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', `${item.product?.name ?? 'An item'} doesn't have enough stock left.`);
    }
  }

  let addressSnapshot;
  if (addrId) {
    if (!customerId) throw new AppError(401, 'UNAUTHENTICATED', 'Log in to use a saved address.');
    const addr = await customersService.getAddr({ companyId, customerId, id: addrId });
    addressSnapshot = { label: addr.label, name, phone, line1: addr.line1, line2: addr.line2, city: addr.city, area: addr.area, notes: addr.notes };
  } else {
    addressSnapshot = { ...address, name, phone };
  }

  const orderId = await withCompany(companyId, async (conn) => {
    try {
      let resolvedCustomerId = customerId;
      if (!resolvedCustomerId) {
        const guest = await customersService.findOrCreateGuestCustomer(conn, { companyId, name, phone, email });
        resolvedCustomerId = guest.ID;
      }

      const cartRow = await cartsService.findCartRowForUpdate(conn, { companyId, token: cartToken });
      if (!cartRow) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty.');
      const rawItems = await cartsService.getCartItemsForUpdate(conn, { companyId, cartId: cartRow.ID });
      if (rawItems.length === 0) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty.');

      const variantMap = await productsService.getVariantsForCart({
        companyId,
        ids: rawItems.map((item) => item.VARIANT_ID),
      });

      // Pass 1: validate and total, before writing anything.
      const lines = [];
      let subtotal = 0;
      for (const raw of rawItems) {
        const variant = variantMap.get(raw.VARIANT_ID);
        if (!variant || !variant.isAvailable) {
          throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'One of the items in your cart is no longer available.');
        }
        const unitPrice = variant.salePrice ?? variant.price;
        const lineTotal = round2(unitPrice * raw.QTY);
        subtotal += lineTotal;
        lines.push({
          variantId: raw.VARIANT_ID,
          qty: raw.QTY,
          sku: variant.sku,
          nameSnap: variant.variantName ? `${variant.productName} — ${variant.variantName}` : variant.productName,
          optsSnap: stringifyJson(variant.opts ?? {}),
          priceSnap: unitPrice,
          lineTotal,
        });
      }
      subtotal = round2(subtotal);
      const discount = 0;
      const total = round2(subtotal - discount);

      const orderNo = await repo.nextOrderNo(conn, { companyId });
      const id = await repo.insertOrder(conn, {
        companyId,
        orderNo,
        customerId: resolvedCustomerId,
        status: 'new',
        name,
        email: email ?? null,
        phone,
        address: stringifyJson(addressSnapshot),
        note: note ?? null,
        subtotal,
        discount,
        total,
        currency: company?.currency ?? null,
        lang: lang ?? null,
      });

      // Pass 2: the actual write. Each decrement is conditioned on there
      // still being enough stock — if a concurrent checkout won the race on
      // this exact variant since pass 1's read, this throws and the whole
      // order (including the row just inserted) rolls back.
      for (const line of lines) {
        const ok = await productsService.decrementStockForOrder(conn, {
          companyId,
          variantId: line.variantId,
          qty: line.qty,
          orderId: id,
        });
        if (!ok) {
          throw new AppError(409, 'INSUFFICIENT_STOCK', `${line.nameSnap} doesn't have enough stock left.`);
        }
        await repo.insertOrderItem(conn, { companyId, orderId: id, ...line });
      }

      await repo.insertOrderLog(conn, {
        companyId,
        orderId: id,
        fromStatus: null,
        toStatus: 'new',
        adminId: null,
        note: 'Order placed.',
      });

      await conn.commit();
      return id;
    } catch (err) {
      await conn.rollback();
      throw err;
    }
  });

  // Cart clearing, idempotency bookkeeping, and email are deliberately
  // outside the transaction — an email provider outage must never roll back
  // an order that has already committed.
  await cartsService.clearCart({ companyId, token: cartToken, customerId });
  if (idemKey) await redis.set(idemKey, String(orderId), 'EX', IDEMPOTENCY_TTL_SECONDS);

  const order = await getOrder({ companyId, id: orderId });
  await sendOrderConfirmation({ company, order }).catch(() => {});
  await sendAdminNewOrderNotice({ company, order }).catch(() => {});
  return order;
}

/* ------------------------------------------------------------ admin/orders */

export async function listOrders({ companyId, page, pageSize, status, search, dateFrom, dateTo }) {
  const { rows, total } = await withCompany(companyId, (conn) =>
    repo.listOrders(conn, { companyId, page, pageSize, status, search, dateFrom, dateTo }),
  );
  return { rows: camelRows(rows), total, page, pageSize };
}

export async function listOrdersForExport({ companyId, status, search, dateFrom, dateTo }) {
  const rows = await withCompany(companyId, (conn) =>
    repo.listOrdersForExport(conn, { companyId, status, search, dateFrom, dateTo }),
  );
  return camelRows(rows);
}

export async function updateStatus({ companyId, id, status, note, actorAdminId }) {
  const order = await withCompany(companyId, async (conn) => {
    const existing = await repo.findOrderById(conn, { companyId, id });
    if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');

    const allowed = STATUS_TRANSITIONS[existing.STATUS] ?? [];
    if (!allowed.includes(status)) {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `An order cannot move from "${existing.STATUS}" to "${status}".`,
      );
    }

    await repo.updateOrderStatus(conn, { companyId, id, status });
    await repo.insertOrderLog(conn, {
      companyId,
      orderId: id,
      fromStatus: existing.STATUS,
      toStatus: status,
      adminId: actorAdminId,
      note,
    });
    await conn.commit();
    return existing;
  });

  const updated = await getOrder({ companyId, id });
  const company = await loadCompanyForEmail(companyId);
  await sendOrderStatusChanged({ company, order: updated, fromStatus: order.STATUS }).catch(() => {});
  return updated;
}

export async function patchOrder({ companyId, id, note, name, phone, email }) {
  await withCompany(companyId, async (conn) => {
    const existing = await repo.findOrderById(conn, { companyId, id });
    if (!existing) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    await repo.updateOrderContact(conn, { companyId, id, note, name, phone, email });
    await conn.commit();
  });
  return getOrder({ companyId, id });
}

/* --------------------------------------------------------- customer-facing */

export async function listMyOrders({ companyId, customerId, page, pageSize }) {
  const { rows, total } = await withCompany(companyId, (conn) =>
    repo.listOrders(conn, { companyId, customerId, page, pageSize }),
  );
  return { rows: camelRows(rows), total, page, pageSize };
}
