import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';

const TRANSITIONS = {
  new: ['confirmed', 'cancelled'],
  confirmed: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const STATUS_LABELS = { new: 'New', confirmed: 'Confirmed', delivered: 'Delivered', cancelled: 'Cancelled' };

export function OrderDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [order, setOrder] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.getOrder(token, id);
      setOrder(res.order);
      setNote(res.order.note ?? '');
    } catch (err) {
      setError(err.message ?? 'Failed to load order.');
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(status) {
    setBusy(true);
    try {
      await api.patchOrderStatus(token, id, { status });
      toast.success(`Order marked ${STATUS_LABELS[status].toLowerCase()}.`);
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to update status.');
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    setBusy(true);
    try {
      await api.patchOrder(token, id, { note });
      toast.success('Note saved.');
    } catch (err) {
      toast.error(err.message ?? 'Failed to save note.');
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (!order) return <p className="text-gray-500">Loading…</p>;

  const nextStatuses = TRANSITIONS[order.status] ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Order #{order.orderNo}</h1>
        <div className="flex gap-2">
          {nextStatuses.map((status) => (
            <button
              key={status}
              type="button"
              disabled={busy}
              onClick={() => changeStatus(status)}
              className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                status === 'cancelled'
                  ? 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Mark {STATUS_LABELS[status].toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Customer</h2>
          <p className="mt-1 text-sm text-gray-700">{order.name}</p>
          <p className="text-sm text-gray-500">{order.phone}</p>
          {order.email && <p className="text-sm text-gray-500">{order.email}</p>}
        </div>
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Delivery address</h2>
          {order.address ? (
            <address className="mt-1 whitespace-pre-line text-sm not-italic text-gray-700">
              {[order.address.label, order.address.line1, order.address.line2, order.address.city, order.address.area]
                .filter(Boolean)
                .join('\n')}
              {order.address.notes && <div className="mt-1 text-xs text-gray-500">{order.address.notes}</div>}
            </address>
          ) : (
            <p className="text-sm text-gray-500">—</p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Items</h2>
        <table className="mt-2 min-w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1">Item</th>
              <th className="py-1">Qty</th>
              <th className="py-1 text-right">Price</th>
              <th className="py-1 text-right">Line total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {order.items.map((item) => (
              <tr key={item.id}>
                <td className="py-1.5">
                  {item.nameSnap}
                  {Object.keys(item.optsSnap ?? {}).length > 0 && (
                    <span className="ml-1 text-xs text-gray-500">
                      ({Object.entries(item.optsSnap).map(([k, v]) => `${k}: ${v}`).join(', ')})
                    </span>
                  )}
                </td>
                <td className="py-1.5">{item.qty}</td>
                <td className="py-1.5 text-right">{item.priceSnap}</td>
                <td className="py-1.5 text-right">{item.lineTotal}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-end text-sm">
          <div className="w-48 space-y-1">
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span>
              <span>{order.subtotal}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex justify-between text-gray-600">
                <span>Discount</span>
                <span>-{order.discount}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-gray-900">
              <span>Total</span>
              <span>
                {order.total} {order.currency ?? ''}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Note</h2>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={busy}
          onClick={saveNote}
          className="mt-2 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          Save note
        </button>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">History</h2>
        <ul className="mt-2 space-y-1 text-sm text-gray-600">
          {order.log.map((entry) => (
            <li key={entry.id}>
              <span className="text-gray-400">{new Date(entry.createdAt).toLocaleString()}</span>{' '}
              {entry.fromStatus ? `${entry.fromStatus} → ${entry.toStatus}` : `Order placed (${entry.toStatus})`}
              {entry.note && <span className="text-gray-500"> — {entry.note}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
