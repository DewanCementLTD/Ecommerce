import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';
import { SortableList, DragHandle } from '../../components/SortableList.jsx';

const RULE_FIELDS = ['cat_id', 'brand', 'tag', 'price', 'is_featured'];
const RULE_OPS = ['eq', 'neq', 'gt', 'lt', 'in'];

const inputClass =
  'w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function CollectionEditorPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { token } = useAuth();

  const [form, setForm] = useState({ name: '', descr: '', type: 'manual', isActive: 1 });
  const [rules, setRules] = useState({ match: 'all', conditions: [] });
  const [members, setMembers] = useState([]); // manual: [{id, name}]
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const [collRes, productsRes] = await Promise.all([
        api.getColl(token, id),
        api.getCollProducts(token, id, { pageSize: 500 }),
      ]);
      setForm({
        name: collRes.coll.name,
        descr: collRes.coll.descr ?? '',
        type: collRes.coll.type,
        isActive: collRes.coll.isActive,
      });
      setRules(collRes.coll.rules ?? { match: 'all', conditions: [] });
      setMembers(productsRes.rows ?? []);
    } catch (err) {
      setError(err.message ?? 'Failed to load collection.');
    } finally {
      setLoading(false);
    }
  }, [token, id, isNew]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const body = {
      name: form.name,
      descr: form.descr || null,
      type: form.type,
      isActive: form.isActive,
      rules: form.type === 'auto' ? rules : null,
    };
    try {
      if (isNew) {
        const res = await api.createColl(token, {
          ...body,
          productIds: form.type === 'manual' ? members.map((m) => m.id) : undefined,
        });
        toast.success('Collection created.');
        navigate(`/collections/${res.coll.id}`, { replace: true });
      } else {
        await api.patchColl(token, id, body);
        toast.success('Changes saved.');
      }
    } catch (err) {
      setError(err.message ?? 'Failed to save collection.');
    } finally {
      setSaving(false);
    }
  }

  async function saveMembers(nextMembers) {
    setMembers(nextMembers);
    if (isNew) return; // saved together with the create call
    try {
      await api.putCollProducts(token, id, nextMembers.map((m) => m.id));
    } catch (err) {
      toast.error(err.message ?? 'Failed to save products — reverting.');
      load();
    }
  }

  async function runSearch(e) {
    e.preventDefault();
    if (!searchTerm.trim()) return;
    try {
      const res = await api.listProducts(token, { search: searchTerm, pageSize: 10 });
      setSearchResults(res.rows.filter((p) => !members.some((m) => m.id === p.id)));
    } catch (err) {
      toast.error(err.message ?? 'Search failed.');
    }
  }

  function addCondition() {
    setRules((r) => ({ ...r, conditions: [...r.conditions, { field: 'cat_id', op: 'eq', value: '' }] }));
  }

  function updateCondition(index, patch) {
    setRules((r) => ({
      ...r,
      conditions: r.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{isNew ? 'New collection' : form.name}</h1>
        {!isNew && (
          <ConfirmButton
            label="Delete collection"
            confirmTitle="Delete this collection?"
            confirmMessage={`This permanently deletes "${form.name}". Products in it are not deleted.`}
            onConfirm={async () => {
              await api.deleteColl(token, id);
              toast.success('Collection deleted.');
              navigate('/collections', { replace: true });
            }}
          />
        )}
      </div>

      {error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="descr" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="descr"
            rows={3}
            value={form.descr}
            onChange={(e) => setForm((f) => ({ ...f, descr: e.target.value }))}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <span className="block text-sm font-medium text-gray-700">Type</span>
            <div className="mt-1 flex gap-4">
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={form.type === 'manual'}
                  onChange={() => setForm((f) => ({ ...f, type: 'manual' }))}
                />
                Manual
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-700">
                <input
                  type="radio"
                  checked={form.type === 'auto'}
                  onChange={() => setForm((f) => ({ ...f, type: 'auto' }))}
                />
                Automatic
              </label>
            </div>
          </div>
          <label className="mt-5 flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isActive === 1}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked ? 1 : 0 }))}
            />
            Active
          </label>
        </div>

        {form.type === 'auto' && (
          <div className="rounded border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Match</span>
              <select
                value={rules.match}
                onChange={(e) => setRules((r) => ({ ...r, match: e.target.value }))}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="all">All conditions</option>
                <option value="any">Any condition</option>
              </select>
            </div>
            <div className="mt-2 space-y-2">
              {rules.conditions.map((c, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <select
                    value={c.field}
                    onChange={(e) => updateCondition(index, { field: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {RULE_FIELDS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                  <select
                    value={c.op}
                    onChange={(e) => updateCondition(index, { op: e.target.value })}
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                  >
                    {RULE_OPS.map((op) => (
                      <option key={op} value={op}>
                        {op}
                      </option>
                    ))}
                  </select>
                  <input
                    value={c.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value })}
                    placeholder="Value (comma-separate for 'in')"
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setRules((r) => ({ ...r, conditions: r.conditions.filter((_, i) => i !== index) }))}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addCondition} className="mt-2 text-sm font-medium text-blue-700 hover:underline">
              + Add condition
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : isNew ? 'Create collection' : 'Save changes'}
        </button>
      </form>

      {form.type === 'manual' && (
        <section className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-900">Products</h2>
          <form onSubmit={runSearch} className="mt-2 flex gap-2">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search products to add"
              className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
            <button type="submit" className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100">
              Search
            </button>
          </form>
          {searchResults.length > 0 && (
            <ul className="mt-2 divide-y divide-gray-100 rounded border border-gray-200">
              {searchResults.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  {p.name}
                  <button
                    type="button"
                    onClick={() => {
                      saveMembers([...members, { id: p.id, name: p.name }]);
                      setSearchResults((r) => r.filter((x) => x.id !== p.id));
                    }}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4">
            {members.length === 0 ? (
              <p className="text-sm text-gray-500">No products yet.</p>
            ) : (
              <SortableList
                items={members}
                onReorder={saveMembers}
                renderItem={(m, handleProps) => (
                  <div className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2 text-sm">
                    <DragHandle {...handleProps} />
                    <span className="flex-1">{m.name}</span>
                    <button
                      type="button"
                      onClick={() => saveMembers(members.filter((x) => x.id !== m.id))}
                      className="text-xs font-medium text-red-600 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                )}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
