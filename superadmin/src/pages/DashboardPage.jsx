import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

/**
 * The platform dashboard (Phase 3, Task 4).
 *
 * Four questions, in the order someone opening this page at 9am actually asks
 * them: is anything on fire, who is selling, who is using disk, and what is
 * slow. Everything is computed by the API in SQL — this component formats and
 * nothing else.
 */

function bytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(value ?? 0);
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n < 10 && unit > 0 ? n.toFixed(1) : Math.round(n)} ${units[unit]}`;
}

function ago(value) {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Stat({ label, value, tone = 'default', hint }) {
  const tones = {
    default: 'text-gray-900',
    good: 'text-green-700',
    warn: 'text-amber-700',
    bad: 'text-red-700',
  };
  return (
    <div className="rounded border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await api.getOverview(token));
    } catch (err) {
      setError(err.message ?? 'Failed to load the dashboard.');
    }
  }, [token]);

  useEffect(() => {
    load();
    // Slow enough not to be noise, often enough that a page left open is not
    // lying about the last hour.
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;

  const { companies, orders, storage, requests } = data;
  const errorRate = requests.available ? requests.errorRate : null;
  const orders24h = orders.reduce((sum, row) => sum + row.orders24h, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-gray-900">Platform</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Companies" value={companies.total} hint={`${companies.active} active`} />
        <Stat
          label="Suspended"
          value={companies.suspended}
          tone={companies.suspended > 0 ? 'warn' : 'good'}
        />
        <Stat label="Orders (24h)" value={orders24h} hint="across every store" />
        <Stat
          label="Error rate (1h)"
          value={errorRate === null ? '—' : `${(errorRate * 100).toFixed(2)}%`}
          tone={errorRate === null ? 'default' : errorRate > 0.01 ? 'bad' : 'good'}
          hint={
            requests.available
              ? `${requests.requests} requests, ${requests.serverErrors} 5xx`
              : 'metrics unavailable (Redis)'
          }
        />
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-900">Orders per company</h2>
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2">Company</th>
                <th scope="col" className="px-3 py-2 text-right">24h</th>
                <th scope="col" className="px-3 py-2 text-right">7d</th>
                <th scope="col" className="px-3 py-2 text-right">Revenue (7d)</th>
                <th scope="col" className="px-3 py-2">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {orders.map((row) => (
                <tr key={row.companyId}>
                  <td className="px-3 py-2">
                    <Link to={`/companies/${row.companyId}`} className="text-blue-700 hover:underline">
                      {row.name}
                    </Link>
                    {row.status === 'suspended' && (
                      <span className="ms-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        suspended
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.orders24h}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.orders7d}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(row.revenue7d ?? 0).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{ago(row.lastOrderAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">Storage per company</h2>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Company</th>
                  <th scope="col" className="px-3 py-2 text-right">Files</th>
                  <th scope="col" className="px-3 py-2 text-right">Size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {storage.map((row) => (
                  <tr key={row.companyId}>
                    <td className="px-3 py-2">
                      <Link to={`/companies/${row.companyId}`} className="text-blue-700 hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.files}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{bytes(row.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-gray-900">
            Slowest endpoints{' '}
            <span className="font-normal text-gray-500">(mean over the last hour)</span>
          </h2>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2">Route</th>
                  <th scope="col" className="px-3 py-2 text-right">Calls</th>
                  <th scope="col" className="px-3 py-2 text-right">Mean</th>
                  <th scope="col" className="px-3 py-2 text-right">Worst</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {requests.slowest.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-gray-500">
                      No traffic recorded in the last hour.
                    </td>
                  </tr>
                )}
                {requests.slowest.map((row) => (
                  <tr key={row.route}>
                    <td className="px-3 py-2 font-mono text-xs">{row.route}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.avgMs.toFixed(0)} ms</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">
                      {row.maxMs.toFixed(0)} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
