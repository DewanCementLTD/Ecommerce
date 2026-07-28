import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../../lib/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { AuthedImage } from '../../components/AuthedImage.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';

const PAGE_SIZE = 20;

export function ProductsListPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [isActive, setIsActive] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await api.listProducts(token, {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        isActive: isActive || undefined,
      });
      setRows(res.rows);
      setTotal(res.total);
      setSelected(new Set());
    } catch (err) {
      setError(err.message ?? 'Failed to load products.');
    }
  }, [token, page, search, isActive]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleSelected(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runBulk(action) {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const res = await api.bulkProducts(token, [...selected], action);
      toast.success(`${res.affected} of ${res.requested} product(s) updated.`);
      await load();
    } catch (err) {
      toast.error(err.message ?? 'Bulk action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Products</h1>
        <Link
          to="/products/new"
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          New product
        </Link>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
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
            placeholder="Name or SKU"
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="status" className="block text-xs font-medium text-gray-600">
            Status
          </label>
          <select
            id="status"
            value={isActive}
            onChange={(e) => {
              setIsActive(e.target.value);
              setPage(1);
            }}
            className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <option value="">Any</option>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Filter
        </button>
      </form>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
          <span className="font-medium text-blue-900">{selected.size} selected</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => runBulk('activate')}
            className="rounded border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Activate
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => runBulk('deactivate')}
            className="rounded border border-gray-300 bg-white px-2.5 py-1 font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            Deactivate
          </button>
          <ConfirmButton
            label="Delete"
            confirmTitle="Delete selected products?"
            confirmMessage={`This permanently removes ${selected.size} product(s), their variants, and images. This cannot be undone.`}
            onConfirm={() => runBulk('delete')}
            className="rounded border border-red-300 bg-white px-2.5 py-1 text-sm font-medium text-red-700 hover:bg-red-50"
          />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="w-10 px-4 py-2">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Product
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Price
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Stock
              </th>
              <th scope="col" className="px-4 py-2 text-left font-medium text-gray-600">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelected(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                </td>
                <td className="px-4 py-2">
                  <Link
                    to={`/products/${row.id}`}
                    className="flex items-center gap-3 font-medium text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <AuthedImage
                      src={row.primaryImage ? api.mediaUrl(row.primaryImage.mediaId, 64) : null}
                      alt=""
                      className="h-10 w-10 flex-shrink-0 rounded border border-gray-200 object-cover"
                      fallback={<span className="h-10 w-10 flex-shrink-0 rounded border border-gray-200 bg-gray-50" />}
                    />
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-600">
                  {row.defaultVariant
                    ? row.defaultVariant.salePrice
                      ? `${row.defaultVariant.salePrice} (was ${row.defaultVariant.price})`
                      : row.defaultVariant.price
                    : '—'}
                </td>
                <td className="px-4 py-2 text-gray-600">{row.defaultVariant?.stock ?? '—'}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      row.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {row.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                  No products found.
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
            disabled={page * PAGE_SIZE >= total}
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
