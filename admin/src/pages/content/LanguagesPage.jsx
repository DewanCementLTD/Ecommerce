import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';

export function LanguagesPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState({ code: '', name: '' });

  const load = useCallback(async () => {
    try {
      const res = await api.listLangs(token);
      setRows(res.rows);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load languages.');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function addLang(e) {
    e.preventDefault();
    if (!form.code.trim() || !form.name.trim()) return;
    try {
      await api.createLang(token, { code: form.code.trim(), name: form.name.trim() });
      setForm({ code: '', name: '' });
      toast.success('Language added.');
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to add language.');
    }
  }

  async function makeDefault(id) {
    try {
      await api.patchLang(token, id, { isDefault: 1 });
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to update language.');
    }
  }

  async function toggleActive(id, isActive) {
    try {
      await api.patchLang(token, id, { isActive: isActive ? 1 : 0 });
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to update language.');
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Translations</h1>
      <p className="text-sm text-gray-500">
        Enable languages here, then translate individual products, categories, and pages from their own
        editors.
      </p>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Language</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Code</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Default</th>
              <th className="px-4 py-2 text-left font-medium text-gray-600">Active</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((lang) => (
              <tr key={lang.id}>
                <td className="px-4 py-2">{lang.name}</td>
                <td className="px-4 py-2 text-gray-600">{lang.code}</td>
                <td className="px-4 py-2">
                  {lang.isDefault ? (
                    <span className="text-xs font-medium text-blue-700">Default</span>
                  ) : (
                    <button type="button" onClick={() => makeDefault(lang.id)} className="text-xs font-medium text-gray-600 hover:underline">
                      Make default
                    </button>
                  )}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={!!lang.isActive}
                    disabled={lang.isDefault === 1}
                    onChange={(e) => toggleActive(lang.id, e.target.checked)}
                  />
                </td>
                <td className="px-4 py-2">
                  {!lang.isDefault && (
                    <ConfirmButton
                      label="Remove"
                      confirmTitle={`Remove ${lang.name}?`}
                      confirmMessage="Existing translations in this language are deleted."
                      onConfirm={async () => {
                        await api.deleteLang(token, lang.id);
                        load();
                      }}
                      className="text-xs font-medium text-red-600 hover:underline"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={addLang} className="flex gap-2">
        <input
          value={form.code}
          onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
          placeholder="Code (e.g. ar)"
          className="w-28 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Name (e.g. Arabic)"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Add
        </button>
      </form>
    </div>
  );
}
