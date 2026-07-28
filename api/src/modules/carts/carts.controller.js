import { idParamSchema, addItemSchema, patchItemSchema } from './carts.schema.js';
import * as cartsService from './carts.service.js';

/**
 * The cart token travels as an explicit header, never a cookie the API sets
 * itself — this codebase has no cookie handling anywhere (admin auth is
 * bearer-token-only too), and the Next.js storefront layer is the one place
 * that owns turning this into a browser cookie. See docs/DECISIONS.md.
 */
const tokenOf = (req) => req.headers['x-cart-token'] || undefined;
const customerIdOf = (req) => req.customer?.id;

export async function getCart(req, res, next) {
  try {
    res.json(await cartsService.getCart({ companyId: req.companyId, token: tokenOf(req), customerId: customerIdOf(req) }));
  } catch (err) {
    next(err);
  }
}

export async function postItem(req, res, next) {
  try {
    const body = addItemSchema.parse(req.body);
    res.status(201).json(
      await cartsService.addItem({ companyId: req.companyId, token: tokenOf(req), customerId: customerIdOf(req), ...body }),
    );
  } catch (err) {
    next(err);
  }
}

export async function patchItem(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    const { qty } = patchItemSchema.parse(req.body);
    res.json(
      await cartsService.updateItem({
        companyId: req.companyId,
        token: tokenOf(req),
        customerId: customerIdOf(req),
        itemId: id,
        qty,
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteItem(req, res, next) {
  try {
    const { id } = idParamSchema.parse(req.params);
    res.json(
      await cartsService.removeItem({ companyId: req.companyId, token: tokenOf(req), customerId: customerIdOf(req), itemId: id }),
    );
  } catch (err) {
    next(err);
  }
}

export async function deleteCart(req, res, next) {
  try {
    res.json(await cartsService.clearCart({ companyId: req.companyId, token: tokenOf(req), customerId: customerIdOf(req) }));
  } catch (err) {
    next(err);
  }
}
