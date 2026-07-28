import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

function StatCard({ label, value, delta, deltaLabel }) {
  const positive = delta === undefined || delta >= 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">{value}</p>
      {delta !== undefined && (
        <p className={`mt-1 text-xs font-medium ${positive ? 'text-green-700' : 'text-red-700'}`}>
          {positive ? '+' : ''}
          {delta} vs {deltaLabel}
        </p>
      )}
    </div>
  );
}

export function DashboardPage() {
  const { token, admin } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getDashboardSummary(token)
      .then(setSummary)
      .catch((err) => setError(err.message ?? 'Failed to load dashboard.'));
  }, [token]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Welcome{admin?.name ? `, ${admin.name}` : ''}</h1>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {!summary ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Today" value={`${summary.today.revenue} (${summary.today.orderCount} orders)`} />
            <StatCard
              label="Last 7 days"
              value={`${summary.last7Days.revenue} (${summary.last7Days.orderCount} orders)`}
              delta={summary.last7Days.orderCount - summary.last7Days.priorOrderCount}
              deltaLabel="prior 7 days"
            />
            <StatCard
              label="Last 30 days"
              value={`${summary.last30Days.revenue} (${summary.last30Days.orderCount} orders)`}
              delta={summary.last30Days.orderCount - summary.last30Days.priorOrderCount}
              deltaLabel="prior 30 days"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Needs attention</h2>
              <ul className="mt-2 space-y-1 text-sm">
                <li>
                  <Link to="/orders?status=new" className="text-blue-700 hover:underline">
                    {summary.awaitingConfirmation} order(s) awaiting confirmation
                  </Link>
                </li>
                <li className="text-gray-700">{summary.outOfStockCount} product(s) out of stock</li>
                {summary.lowStock.length > 0 && (
                  <li className="text-gray-700">
                    Low stock:{' '}
                    {summary.lowStock
                      .slice(0, 5)
                      .map((v) => `${v.productName} (${v.stock})`)
                      .join(', ')}
                  </li>
                )}
              </ul>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-900">Selling well (30 days)</h2>
              {summary.topProducts.length === 0 ? (
                <p className="mt-2 text-sm text-gray-500">No sales yet.</p>
              ) : (
                <ol className="mt-2 space-y-1 text-sm text-gray-700">
                  {summary.topProducts.map((p, i) => (
                    <li key={i} className="flex justify-between">
                      <span>{p.name}</span>
                      <span className="text-gray-500">{p.qty}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-900">Revenue, last 30 days</h2>
            {summary.revenueSeries.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500">No revenue yet.</p>
            ) : (
              <div className="mt-3 flex h-32 items-end gap-1">
                {summary.revenueSeries.map((point, i) => {
                  const max = Math.max(...summary.revenueSeries.map((p) => p.revenue), 1);
                  return (
                    <div
                      key={i}
                      title={`${new Date(point.day).toLocaleDateString()}: ${point.revenue}`}
                      className="flex-1 rounded-t bg-blue-500"
                      style={{ height: `${Math.max((point.revenue / max) * 100, 2)}%` }}
                    />
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
