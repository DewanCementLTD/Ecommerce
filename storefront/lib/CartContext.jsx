'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const CartContext = createContext(null);

async function callApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? 'Something went wrong.');
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

/**
 * Cart state lives here, backed by the Next route handlers under app/api/cart —
 * never a direct call to the Express API, since only the route handlers can
 * see this request's real Host and own the cart_token cookie (see
 * lib/server-fetch.js). Rendered once at the layout root so the drawer and
 * the header's item-count badge share one source of truth.
 */
export function CartProvider({ children }) {
  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    callApi('/api/cart')
      .then(setCart)
      .finally(() => setLoading(false));
  }, []);

  const addItem = useCallback(async (variantId, qty = 1) => {
    const data = await callApi('/api/cart/items', { method: 'POST', body: { variantId, qty } });
    setCart(data);
    setDrawerOpen(true);
    return data;
  }, []);

  const updateItem = useCallback(async (itemId, qty) => {
    const data = await callApi(`/api/cart/items/${itemId}`, { method: 'PATCH', body: { qty } });
    setCart(data);
    return data;
  }, []);

  const removeItem = useCallback(async (itemId) => {
    const data = await callApi(`/api/cart/items/${itemId}`, { method: 'DELETE' });
    setCart(data);
    return data;
  }, []);

  const clearCart = useCallback(async () => {
    const data = await callApi('/api/cart', { method: 'DELETE' });
    setCart(data);
    return data;
  }, []);

  const count = cart?.items?.reduce((sum, item) => sum + item.qty, 0) ?? 0;

  return (
    <CartContext.Provider
      value={{ cart, loading, count, addItem, updateItem, removeItem, clearCart, drawerOpen, setDrawerOpen }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
