import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

export function LogsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [adminId, setAdminId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [error, setError] = useState('');
  const pageSize = 25;

  const load = useCallback(async () => {
    setError('');
    try {
      const params = { page, pageSize };
      if (action) params.action = action;
      if (companyId) params.companyId = companyId;
      if (adminId) params.adminId = adminId;
      if (dateFrom) params.dateFrom = new Date(dateFrom).toISOString();
      if (dateTo) params.dateTo = new Date(dateTo).toISOString();
      const res = await api.listLogs(token, params);
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err.message ?? 'Failed to load audit log.');
    }
  }, [token, page, action, companyId, adminId, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Audit log</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <label htmlFor="action" className="block text-xs font-medium text-gray-600">
            Action
          </label>
          <input
            id="action"
            type="text"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="e.g. company_created"
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="companyId" className="block text-xs font-medium text-gray-600">
            Company id
          </label>
          <input
            id="companyId"
            type="number"
            min="1"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="mt-1 w-28 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="adminId" className="block text-xs font-medium text-gray-600">
            Admin id
          </label>
          <input
            id="adminId"
            type="number"
            min="1"
            value={adminId}
            onChange={(e) => setAdminId(e.target.value)}
            className="mt-1 w-28 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="dateFrom" className="block text-xs font-medium text-gray-600">
            From
          </label>
          <input
            id="dateFrom"
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="dateTo" className="block text-xs font-medium text-gray-600">
            To
          </label>
          <input
            id="dateTo"
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <button
          type="submit"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Filter
        </button>
        <button
          type="button"
          onClick={() => {
            setAction('');
            setCompanyId('');
            setAdminId('');
            setDateFrom('');
            setDateTo('');
            setPage(1);
          }}
          className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Clear
        </button>
      </form>

      {/*
        Impersonation is the action this browser exists for. One click to see
        every "view as company" ever issued, without knowing to type the
        action name.
      */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-gray-500">Quick filters:</span>
        {['impersonate', 'company_suspended', 'login_failed', 'company_created'].map((quick) => (
          <button
            key={quick}
            type="button"
            onClick={() => {
              setAction(quick);
              setPage(1);
            }}
            className={`rounded border px-2 py-0.5 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              action === quick
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            {quick}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                When
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Action
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Entity
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Company
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Admin
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Meta
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.ID}>
                <td className="whitespace-nowrap px-4 py-2 text-gray-600">
                  {new Date(row.CREATED_AT).toLocaleString()}
                </td>
                <td className="px-4 py-2 font-medium text-gray-900">{row.ACTION}</td>
                <td className="px-4 py-2 text-gray-600">
                  {row.ENTITY ?? '—'}
                  {row.ENTITY_ID ? ` #${row.ENTITY_ID}` : ''}
                </td>
                <td className="px-4 py-2 text-gray-600">{row.COMPANY_ID ?? '—'}</td>
                <td className="px-4 py-2 text-gray-600">{row.ADMIN_ID ?? '—'}</td>
                <td className="max-w-xs truncate px-4 py-2 font-mono text-xs text-gray-500">{row.META}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No log entries.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{total} total</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page * pageSize >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
