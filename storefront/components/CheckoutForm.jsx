'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCart } from '../lib/CartContext.jsx';
import { useAccount } from '../lib/AccountContext.jsx';
import { Media, Price, Button, EmptyState } from './ui.jsx';

const inputClass =
  'mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent';

function newIdempotencyKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * One screen, no wizard — the whole point of a COD checkout. The button says
 * what happens ("Place order", never "Submit"); the confirmation never
 * implies a payment was taken, because none was.
 */
export function CheckoutForm({ hrefBase, currency }) {
  const { cart, loading: cartLoading, clearCart } = useCart();
  const { customer } = useAccount();

  const [addresses, setAddresses] = useState([]);
  const [addrMode, setAddrMode] = useState('new');
  const [selectedAddrId, setSelectedAddrId] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', note: '', line1: '', line2: '', city: '', area: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [order, setOrder] = useState(null);
  const [idemKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (customer) {
      setForm((f) => ({ ...f, name: f.name || customer.name || '', phone: f.phone || customer.phone || '', email: f.email || customer.email || '' }));
      fetch('/api/account/addresses')
        .then((r) => r.json())
        .then((data) => {
          const rows = data.rows ?? [];
          setAddresses(rows);
          if (rows.length > 0) {
            setAddrMode('saved');
            setSelectedAddrId(rows.find((a) => a.isDefault)?.id ?? rows[0].id);
          }
        })
        .catch(() => {});
    }
  }, [customer]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const body = {
        name: form.name,
        phone: form.phone,
        email: form.email || undefined,
        note: form.note || undefined,
        ...(addrMode === 'saved' && selectedAddrId
          ? { addrId: selectedAddrId }
          : { address: { line1: form.line1, line2: form.line2 || undefined, city: form.city, area: form.area || undefined } }),
      };
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message ?? 'Could not place your order.');
      setOrder(data.order);
      await clearCart().catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (order) {
    return (
      <div className="sf-reveal space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-7 w-7">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1>Order #{order.orderNo} placed</h1>
        <p className="mx-auto max-w-prose text-muted">
          Thanks, {order.name}. We&rsquo;ll call you at {order.phone} to confirm delivery. Payment is due on delivery — nothing
          has been charged.
        </p>
        <div className="mx-auto max-w-sm rounded-lg border border-line bg-surface p-4 text-start text-sm">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between py-1">
              <span>
                {item.nameSnap} × {item.qty}
              </span>
              <span>{item.lineTotal}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-line pt-2 font-semibold">
            <span>Total</span>
            <Price price={order.total} currency={currency} />
          </div>
        </div>
        <Button href={hrefBase || '/'}>Continue shopping</Button>
      </div>
    );
  }

  if (!cartLoading && (!cart || cart.items.length === 0)) {
    return (
      <EmptyState
        title="Your basket is empty"
        body="Add something to your basket before checking out."
        action={<Button href={hrefBase || '/'}>Browse the shop</Button>}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <h1>Checkout</h1>

      <section aria-labelledby="review-heading">
        <h2 id="review-heading" className="text-base font-semibold">
          Your order
        </h2>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {(cart?.items ?? []).map((item) => (
            <li key={item.id} className="flex items-center gap-3 p-3">
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-surface">
                <Media path={item.product?.image?.url} alt={item.product?.name} ratio="aspect-square" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.product?.name}</p>
                <p className="text-xs text-muted">Qty {item.qty}</p>
              </div>
              <Price price={item.lineTotal} currency={currency} className="text-sm" />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between text-sm font-semibold">
          <span>Total</span>
          <Price price={cart?.subtotal ?? 0} currency={currency} />
        </div>
      </section>

      <section aria-labelledby="contact-heading" className="space-y-4">
        <h2 id="contact-heading" className="text-base font-semibold">
          Contact details
        </h2>
        <div>
          <label htmlFor="name" className="text-sm font-medium">
            Full name
          </label>
          <input
            id="name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="phone" className="text-sm font-medium">
            Phone
          </label>
          <input
            id="phone"
            required
            type="tel"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="email" className="text-sm font-medium">
            Email (optional)
          </label>
          <input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className={inputClass}
          />
        </div>
      </section>

      <section aria-labelledby="address-heading" className="space-y-4">
        <h2 id="address-heading" className="text-base font-semibold">
          Delivery address
        </h2>

        {addresses.length > 0 && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={addrMode === 'saved'} onChange={() => setAddrMode('saved')} />
              Use a saved address
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={addrMode === 'new'} onChange={() => setAddrMode('new')} />
              Enter a new address
            </label>
          </div>
        )}

        {addrMode === 'saved' && addresses.length > 0 ? (
          <div className="space-y-2">
            {addresses.map((addr) => (
              <label key={addr.id} className="flex items-start gap-2 rounded-md border border-line p-3 text-sm">
                <input
                  type="radio"
                  name="addr"
                  checked={selectedAddrId === addr.id}
                  onChange={() => setSelectedAddrId(addr.id)}
                  className="mt-1"
                />
                <span>
                  {addr.label && <strong className="block">{addr.label}</strong>}
                  {addr.line1}
                  {addr.line2 ? `, ${addr.line2}` : ''}, {addr.city}
                  {addr.area ? `, ${addr.area}` : ''}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="line1" className="text-sm font-medium">
                Address
              </label>
              <input
                id="line1"
                required
                value={form.line1}
                onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="line2" className="text-sm font-medium">
                Apartment, floor, etc. (optional)
              </label>
              <input
                id="line2"
                value={form.line2}
                onChange={(e) => setForm((f) => ({ ...f, line2: e.target.value }))}
                className={inputClass}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="city" className="text-sm font-medium">
                  City
                </label>
                <input
                  id="city"
                  required
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label htmlFor="area" className="text-sm font-medium">
                  Area (optional)
                </label>
                <input
                  id="area"
                  value={form.area}
                  onChange={(e) => setForm((f) => ({ ...f, area: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        )}

        <div>
          <label htmlFor="note" className="text-sm font-medium">
            Order note (optional)
          </label>
          <textarea
            id="note"
            rows={2}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className={inputClass}
          />
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-md bg-sale/10 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center rounded-pill bg-primary px-6 py-3 text-sm font-semibold text-primary-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Placing order…' : 'Place order'}
        </button>
        <p className="text-center text-xs text-muted">
          Cash on delivery. We&rsquo;ll call you to confirm — nothing is charged now.
        </p>
      </div>

      {!customer && (
        <p className="text-center text-sm text-muted">
          <Link href={`${hrefBase}/account`} className="underline hover:text-accent">
            Log in
          </Link>{' '}
          to save this address for next time.
        </p>
      )}
    </form>
  );
}
