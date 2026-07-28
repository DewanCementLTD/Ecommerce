import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

/**
 * The per-company health card (Phase 3, Task 4): last order, catalog size, when
 * a human last logged in, and whether the store's domains actually serve valid
 * HTTPS.
 *
 * The SSL check is behind a button rather than automatic. Each domain costs a
 * real TLS handshake against a possibly-unreachable host, and the answer
 * changes about as often as a certificate is renewed — paying three seconds
 * per row on every page load to learn nothing new is not a trade worth making.
 */

function ago(value) {
  if (!value) return null;
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function bytes(value) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = Number(value ?? 0);
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit += 1;
  }
  return `${n < 10 && unit > 0 ? n.toFixed(1) : Math.round(n)} ${units[unit]}`;
}

function Row({ label, value, tone }) {
  const tones = { warn: 'text-amber-700', bad: 'text-red-700', good: 'text-green-700' };
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd className={`text-sm font-medium ${tones[tone] ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}

export function HealthCard({ companyId }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [checkingSsl, setCheckingSsl] = useState(false);

  const load = useCallback(
    async (withSsl = false) => {
      setError('');
      try {
        setData(await api.getCompanyHealth(token, companyId, withSsl));
      } catch (err) {
        setError(err.message ?? 'Failed to load health.');
      }
    },
    [token, companyId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (error) {
    return (
      <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }
  if (!data) return <p className="text-sm text-gray-500">Loading health…</p>;

  const { health, domains, ssl } = data;
  // A store with products, no orders in a fortnight and no admin login is not
  // "quiet", it is a client who has stopped using the thing they are paying
  // for. Surfacing it here is the point of the card.
  const staleOrders =
    health.lastOrderAt && Date.now() - new Date(health.lastOrderAt).getTime() > 14 * 86400000;

  return (
    <section className="rounded border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-900">Health</h2>
        <button
          type="button"
          disabled={checkingSsl}
          onClick={async () => {
            setCheckingSsl(true);
            await load(true);
            setCheckingSsl(false);
          }}
          className="rounded border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {checkingSsl ? 'Checking SSL…' : 'Check SSL'}
        </button>
      </div>

      <dl className="divide-y divide-gray-100">
        <Row
          label="Last order"
          value={ago(health.lastOrderAt) ?? 'no orders yet'}
          tone={staleOrders ? 'warn' : undefined}
        />
        <Row label="Orders" value={`${health.orderCount} total, ${health.ordersAwaiting} awaiting`} />
        <Row
          label="Products"
          value={`${health.activeProductCount} active of ${health.productCount}`}
          tone={health.productCount === 0 ? 'warn' : undefined}
        />
        <Row label="Customers" value={health.customerCount} />
        <Row label="Storage" value={bytes(health.storageBytes)} />
        <Row
          label="Admin last login"
          value={ago(health.adminLastLoginAt) ?? 'never'}
          tone={health.adminLastLoginAt ? undefined : 'warn'}
        />
        <Row
          label="Active staff logins"
          value={health.activeAdminCount}
          tone={health.activeAdminCount === 0 ? 'bad' : undefined}
        />
        <Row label="Last activity" value={ago(health.lastActivityAt) ?? 'none'} />
      </dl>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Domains</h3>
      <ul className="mt-1 space-y-1">
        {domains.map((domain) => {
          const check = ssl?.find((entry) => entry.host === domain.host);
          return (
            <li key={domain.id} className="text-sm">
              <span className="font-mono">{domain.host}</span>
              {domain.isPrimary && (
                <span className="ms-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">primary</span>
              )}
              {check && (
                <span
                  className={`ms-2 text-xs ${check.ok ? 'text-green-700' : 'text-red-700'}`}
                  title={check.issuer ?? undefined}
                >
                  {check.ok
                    ? `SSL ok — expires in ${check.daysRemaining} days${
                        check.issuer ? ` (${check.issuer})` : ''
                      }`
                    : `SSL: ${check.reason}`}
                </span>
              )}
            </li>
          );
        })}
        {domains.length === 0 && <li className="text-sm text-red-700">No domain connected.</li>}
      </ul>
    </section>
  );
}
