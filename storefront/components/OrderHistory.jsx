'use client';

import { useEffect, useState } from 'react';
import { useAccount } from '../lib/AccountContext.jsx';
import { Price, Button, EmptyState } from './ui.jsx';

const STATUS_LABELS = { new: 'Placed', confirmed: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled' };

export function OrderHistory({ hrefBase, currency }) {
  const { customer, loading: accountLoading } = useAccount();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!customer) return;
    fetch('/api/account/orders')
      .then((res) => res.json())
      .then((data) => setOrders(data.rows ?? []))
      .catch(() => setError('Could not load your orders.'));
  }, [customer]);

  if (accountLoading) return <p className="text-muted">Loading…</p>;

  if (!customer) {
    return (
      <EmptyState
        title="Log in to see your orders"
        body="Order history is available once you're signed in."
        action={<Button href={`${hrefBase}/account`}>Log in</Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <h1>My orders</h1>

      {error && (
        <p role="alert" className="rounded-md bg-sale/10 px-3 py-2 text-sm text-sale">
          {error}
        </p>
      )}

      {orders === null ? (
        <p className="text-muted">Loading…</p>
      ) : orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          body="Once you place an order, it'll show up here."
          action={<Button href={hrefBase || '/'}>Start shopping</Button>}
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="font-medium">Order #{order.orderNo}</p>
                <p className="text-sm text-muted">{new Date(order.placedAt).toLocaleDateString()}</p>
              </div>
              <div className="text-end">
                <Price price={order.total} currency={order.currency ?? currency} className="justify-end" />
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {STATUS_LABELS[order.status] ?? order.status}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
