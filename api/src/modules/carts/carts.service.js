import { randomUUID } from 'node:crypto';
import { withCompany } from '../../db/pool.js';
import { AppError } from '../../middleware/error.js';
import * as repo from './carts.repo.js';
import * as productsService from '../products/products.service.js';

const CART_TTL_DAYS = 30;

function newExpiry() {
  return new Date(Date.now() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function currentPriceOf(variant) {
  return variant.salePrice ?? variant.price;
}

/** Borrows or creates the cart for this token, refreshing its 30-day expiry either way. */
async function resolveCart({ companyId, token, customerId }) {
  return withCompany(companyId, async (conn) => {
    let cart = token ? await repo.findCartByToken(conn, { companyId, token }) : null;

    if (!cart) {
      const newToken = randomUUID();
      await repo.insertCart(conn, { companyId, token: newToken, customerId, expiresAt: newExpiry() });
      cart = await repo.findCartByToken(conn, { companyId, token: newToken });
    } else {
      await repo.touchCart(conn, { companyId, id: cart.ID, expiresAt: newExpiry() });
      if (customerId && cart.CUSTOMER_ID !== customerId) {
        await repo.attachCustomer(conn, { companyId, id: cart.ID, customerId });
      }
    }
    await conn.commit();
    return cart;
  });
}

/**
 * Every read revalidates against the live catalog rather than trusting what
 * was snapshotted at add-to-cart time — price changes are surfaced, not
 * silently applied; unavailable/out-of-stock lines are flagged, not hidden.
 */
async function toCartDto({ companyId, cart }) {
  const rows = await withCompany(companyId, (conn) => repo.listCartItems(conn, { companyId, cartId: cart.ID }));
  const variantMap = await productsService.getVariantsForCart({
    companyId,
    ids: rows.map((r) => r.VARIANT_ID),
  });

  const items = rows.map((row) => {
    const v = variantMap.get(row.VARIANT_ID);
    const currentPrice = v ? currentPriceOf(v) : null;
    const unitPrice = currentPrice ?? row.PRICE_SNAP;
    return {
      id: row.ID,
      variantId: row.VARIANT_ID,
      qty: row.QTY,
      priceSnap: row.PRICE_SNAP,
      currentPrice,
      priceChanged: v ? Number(currentPrice) !== Number(row.PRICE_SNAP) : false,
      available: !!v && v.isAvailable,
      inStock: !!v && v.stock >= row.QTY,
      maxQty: v?.stock ?? 0,
      lineTotal: round2(Number(unitPrice) * row.QTY),
      product: v ? { id: v.productId, name: v.productName, slug: v.productSlug, image: v.image } : null,
      variant: v ? { sku: v.sku, name: v.variantName, opts: v.opts } : null,
    };
  });

  return {
    token: cart.TOKEN,
    items,
    subtotal: round2(items.reduce((sum, item) => sum + item.lineTotal, 0)),
    currency: cart.CURRENCY,
  };
}

export async function getCart({ companyId, token, customerId }) {
  const cart = await resolveCart({ companyId, token, customerId });
  return toCartDto({ companyId, cart });
}

async function assertOrderable(variant, requestedQty) {
  if (!variant) throw new AppError(404, 'VARIANT_NOT_FOUND', 'That item is no longer available.');
  if (!variant.isAvailable) throw new AppError(409, 'PRODUCT_UNAVAILABLE', 'That item is no longer available.');
  if (variant.stock < requestedQty) {
    throw new AppError(409, 'INSUFFICIENT_STOCK', `Only ${variant.stock} left in stock.`);
  }
}

export async function addItem({ companyId, token, customerId, variantId, qty }) {
  const cart = await resolveCart({ companyId, token, customerId });
  const variantMap = await productsService.getVariantsForCart({ companyId, ids: [variantId] });
  const variant = variantMap.get(variantId);

  await withCompany(companyId, async (conn) => {
    const existing = await repo.findCartItemByVariant(conn, { companyId, cartId: cart.ID, variantId });
    const nextQty = (existing?.QTY ?? 0) + qty;
    await assertOrderable(variant, nextQty);

    if (existing) {
      await repo.updateCartItemQty(conn, { companyId, cartId: cart.ID, id: existing.ID, qty: nextQty });
    } else {
      await repo.insertCartItem(conn, {
        companyId,
        cartId: cart.ID,
        variantId,
        qty,
        priceSnap: currentPriceOf(variant),
      });
    }
    await conn.commit();
  });

  return toCartDto({ companyId, cart });
}

export async function updateItem({ companyId, token, customerId, itemId, qty }) {
  const cart = await resolveCart({ companyId, token, customerId });

  await withCompany(companyId, async (conn) => {
    const item = await repo.findCartItemById(conn, { companyId, cartId: cart.ID, id: itemId });
    if (!item) throw new AppError(404, 'CART_ITEM_NOT_FOUND', 'That item is not in your cart.');

    const variantMap = await productsService.getVariantsForCart({ companyId, ids: [item.VARIANT_ID] });
    await assertOrderable(variantMap.get(item.VARIANT_ID), qty);

    await repo.updateCartItemQty(conn, { companyId, cartId: cart.ID, id: itemId, qty });
    await conn.commit();
  });

  return toCartDto({ companyId, cart });
}

export async function removeItem({ companyId, token, customerId, itemId }) {
  const cart = await resolveCart({ companyId, token, customerId });
  await withCompany(companyId, async (conn) => {
    await repo.deleteCartItem(conn, { companyId, cartId: cart.ID, id: itemId });
    await conn.commit();
  });
  return toCartDto({ companyId, cart });
}

export async function clearCart({ companyId, token, customerId }) {
  const cart = await resolveCart({ companyId, token, customerId });
  await withCompany(companyId, async (conn) => {
    await repo.deleteCartItems(conn, { companyId, cartId: cart.ID });
    await conn.commit();
  });
  return toCartDto({ companyId, cart });
}

/** Used by checkout (Task 3) — returns the live cart row plus its revalidated line items. */
export async function loadCartForCheckout({ companyId, token }) {
  if (!token) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty.');
  const cart = await withCompany(companyId, (conn) => repo.findCartByToken(conn, { companyId, token }));
  if (!cart) throw new AppError(400, 'CART_EMPTY', 'Your cart is empty.');
  const dto = await toCartDto({ companyId, cart });
  return { cartId: cart.ID, ...dto };
}

/**
 * The rest of checkout's cart access, once it's inside its own transaction —
 * both take the caller's connection instead of opening a new one, so the
 * cart read and the order write are one atomic operation.
 */
export async function findCartRowForUpdate(conn, { companyId, token }) {
  if (!token) return null;
  return repo.findCartByToken(conn, { companyId, token });
}

export async function getCartItemsForUpdate(conn, { companyId, cartId }) {
  return repo.listCartItems(conn, { companyId, cartId });
}
