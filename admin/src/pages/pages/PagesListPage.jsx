import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';

export function PagesListPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [newTitle, setNewTitle] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await api.listPages(token);
      setRows(res.rows);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load pages.');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function createPage(e) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await api.createPage(token, { title: newTitle.trim() });
      setNewTitle('');
      toast.success('Page created.');
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to create page.');
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Pages</h1>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <ul className="divide-y divide-gray-100">
          {rows.map((page) => (
            <li key={page.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <Link to={`/pages/${page.id}`} className="font-medium text-blue-700 hover:underline">
                  {page.title}
                </Link>
                <p className="text-xs text-gray-500">
                  {page.type === 'home' ? 'Homepage' : `/pages/${page.slug}`}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  page.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'
                }`}
              >
                {page.isActive ? 'Active' : 'Inactive'}
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-6 text-center text-gray-500">No pages yet.</li>}
        </ul>
      </div>

      <form onSubmit={createPage} className="flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="New page title"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Add page
        </button>
      </form>
    </div>
  );
}
