import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { api } from '../lib/api.js';

export function CompaniesListPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const pageSize = 20;

  const load = useCallback(async () => {
    setError('');
    try {
      const params = { page, pageSize };
      if (search) params.search = search;
      if (status) params.status = status;
      const res = await api.listCompanies(token, params);
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      setError(err.message ?? 'Failed to load companies.');
    }
  }, [token, page, search, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Companies</h1>
        <Link
          to="/companies/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          New company
        </Link>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
        className="flex flex-wrap items-end gap-3"
      >
        <div>
          <label htmlFor="search" className="block text-xs font-medium text-gray-600">
            Search
          </label>
          <input
            id="search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, biz name, email"
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="status" className="block text-xs font-medium text-gray-600">
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
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
                Name
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Email
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Status
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Created
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.ID}>
                <td className="px-4 py-2">
                  <Link
                    to={`/companies/${row.ID}`}
                    className="font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    {row.NAME}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">{row.EMAIL ?? '—'}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.STATUS === 'active' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {row.STATUS}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-600">{new Date(row.CREATED_AT).toLocaleDateString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                  No companies found.
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
