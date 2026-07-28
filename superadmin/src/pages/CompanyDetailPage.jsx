import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';
import { HealthCard } from '../components/HealthCard.jsx';

/** Where the client admin panel answers, so "view as company" can open it. */
const ADMIN_URL = import.meta.env.VITE_ADMIN_URL ?? 'http://localhost:5173';

export function CompanyDetailPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [company, setCompany] = useState(null);
  const [domains, setDomains] = useState([]);
  const [settings, setSettings] = useState([]);
  const [newHost, setNewHost] = useState('');
  const [impersonateToken, setImpersonateToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [companyRes, domainsRes, settingsRes] = await Promise.all([
        api.getCompany(token, id),
        api.getCompanyDomains(token, id),
        api.getCompanySettings(token, id),
      ]);
      setCompany(companyRes.company);
      setDomains(domainsRes.domains);
      setSettings(settingsRes.settings);
    } catch (err) {
      setError(err.message ?? 'Failed to load company.');
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function withBusy(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (!company) {
    return error ? (
      <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    ) : (
      <p className="text-gray-500">Loading&hellip;</p>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{company.NAME}</h1>
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
              company.STATUS === 'active' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {company.STATUS}
          </span>
        </div>
        <div className="flex gap-2">
          {company.STATUS === 'active' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => withBusy(() => api.suspendCompany(token, id))}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => withBusy(() => api.activateCompany(token, id))}
              className="rounded border border-green-300 bg-green-50 px-3 py-1.5 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              Activate
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              withBusy(async () => {
                const res = await api.impersonate(token, id);
                setImpersonateToken(res.accessToken);
              })
            }
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            View as company
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {impersonateToken && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium">
            A 10-minute token scoped to this company has been issued and logged.
          </p>
          {/*
            The token is handed to the admin panel through the URL fragment,
            which browsers do not send to servers and which does not appear in
            access logs — unlike a query string. The panel picks it up, stores
            it, strips it from the address bar, and shows a banner for as long
            as it is in use.
          */}
          <a
            href={`${ADMIN_URL}/#sf_impersonate=${encodeURIComponent(impersonateToken)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block rounded bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Open the admin panel as {company.NAME}
          </a>
          <p className="mt-2 text-xs text-blue-800">
            Everything done there is recorded against your platform account.
          </p>
        </div>
      )}

      <HealthCard companyId={id} />

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Details</h2>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-gray-500">Email</dt>
          <dd className="text-gray-900">{company.EMAIL ?? '—'}</dd>
          <dt className="text-gray-500">Phone</dt>
          <dd className="text-gray-900">{company.PHONE ?? '—'}</dd>
          <dt className="text-gray-500">Currency</dt>
          <dd className="text-gray-900">{company.CURRENCY ?? '—'}</dd>
          <dt className="text-gray-500">Timezone</dt>
          <dd className="text-gray-900">{company.TIMEZONE ?? '—'}</dd>
        </dl>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Domains</h2>
        <ul className="mt-2 divide-y divide-gray-100 text-sm">
          {domains.map((d) => (
            <li key={d.ID} className="flex items-center justify-between py-2">
              <span>
                {d.HOST} {d.IS_PRIMARY === 1 && <span className="text-xs text-gray-500">(primary)</span>}
              </span>
              {d.IS_PRIMARY !== 1 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => withBusy(() => api.removeDomain(token, d.ID))}
                  className="text-xs font-medium text-red-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
          {domains.length === 0 && <li className="py-2 text-gray-500">No domains.</li>}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            withBusy(async () => {
              await api.addDomain(token, id, newHost);
              setNewHost('');
            });
          }}
          className="mt-3 flex gap-2"
        >
          <label htmlFor="newHost" className="sr-only">
            New domain host
          </label>
          <input
            id="newHost"
            type="text"
            required
            value={newHost}
            onChange={(e) => setNewHost(e.target.value)}
            placeholder="new-domain.example.com"
            className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Add
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Settings</h2>
        <dl className="mt-2 space-y-1 text-sm">
          {settings.map((s) => (
            <div key={s.ID} className="flex gap-2">
              <dt className="w-40 flex-shrink-0 text-gray-500">{s.KEY}</dt>
              <dd className="text-gray-900">{s.VALUE || '—'}</dd>
            </div>
          ))}
          {settings.length === 0 && <p className="text-gray-500">No settings.</p>}
        </dl>
      </section>
    </div>
  );
}
