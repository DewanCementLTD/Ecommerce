'use client';

import { useEffect } from 'react';
import { useCart } from '../lib/CartContext.jsx';
import { useToast } from '../lib/ToastContext.jsx';
import { Media, Price, Button, EmptyState } from './ui.jsx';

export function CartDrawer({ hrefBase = '', currency }) {
  const { cart, loading, drawerOpen, setDrawerOpen, updateItem, removeItem } = useCart();
  const toast = useToast();

  useEffect(() => {
    if (!drawerOpen) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  const items = cart?.items ?? [];

  async function handleQtyChange(item, qty) {
    if (qty < 1) return;
    try {
      await updateItem(item.id, qty);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  async function handleRemove(item) {
    try {
      await removeItem(item.id);
    } catch (err) {
      toast(err.message, { tone: 'error' });
    }
  }

  return (
    // Above the toast's z-40 — the drawer is modal-like and must always stay
    // clickable, even while a toast is showing (e.g. right after add-to-cart,
    // which triggers both at once). Found by an automated click landing on
    // the toast instead of "Go to checkout" during Phase 2 verification.
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close cart"
        onClick={() => setDrawerOpen(false)}
        className="absolute inset-0 bg-ink/40"
      />
      <div className="sf-reveal relative flex h-full w-full max-w-md flex-col bg-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Your basket</h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close"
            className="rounded-full p-1.5 text-muted hover:bg-surface hover:text-ink"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <EmptyState
              title="Your basket is empty"
              body="Browse the shop and add something you like."
              action={
                <Button href={hrefBase || '/'} onClick={() => setDrawerOpen(false)}>
                  Start shopping
                </Button>
              }
            />
          ) : (
            <ul className="space-y-4">
              {items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-surface">
                    <Media path={item.product?.image?.url} alt={item.product?.name} ratio="aspect-square" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.product?.name ?? 'Item no longer available'}</p>
                    {item.variant?.name && <p className="text-xs text-muted">{item.variant.name}</p>}
                    {!item.available && <p className="text-xs font-medium text-sale">No longer available</p>}
                    {item.available && !item.inStock && (
                      <p className="text-xs font-medium text-sale">Only {item.maxQty} left</p>
                    )}
                    {item.priceChanged && <p className="text-xs text-muted">Price updated since you added this</p>}
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center rounded-pill border border-line">
                        <button
                          type="button"
                          onClick={() => handleQtyChange(item, item.qty - 1)}
                          aria-label="Decrease quantity"
                          className="px-2.5 py-1 leading-none hover:text-accent"
                        >
                          −
                        </button>
                        <span className="min-w-6 text-center text-xs font-semibold">{item.qty}</span>
                        <button
                          type="button"
                          onClick={() => handleQtyChange(item, item.qty + 1)}
                          aria-label="Increase quantity"
                          disabled={item.qty >= item.maxQty}
                          className="px-2.5 py-1 leading-none hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          +
                        </button>
                      </div>
                      <Price price={item.currentPrice ?? item.priceSnap} currency={currency} className="text-sm" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(item)}
                    aria-label={`Remove ${item.product?.name ?? 'item'}`}
                    className="self-start text-xs font-medium text-muted hover:text-sale"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-line px-5 py-4">
            <div className="mb-3 flex items-center justify-between text-sm font-semibold">
              <span>Subtotal</span>
              <Price price={cart.subtotal} currency={currency} />
            </div>
            <Button href={`${hrefBase}/checkout`} onClick={() => setDrawerOpen(false)} className="w-full">
              Go to checkout
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
