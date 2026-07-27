import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

export function LogsPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const pageSize = 25;

  const load = useCallback(async () => {
    setError('');
    try {
      const params = { page, pageSize };
      if (action) params.action = action;
      const res = await api.listLogs(token, params);
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err.message ?? 'Failed to load audit log.');
    }
  }, [token, page, action]);

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
        <button
          type="submit"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Filter
        </button>
      </form>

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
