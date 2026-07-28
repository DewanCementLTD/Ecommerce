import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';

const inputClass =
  'w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function ProductVariants({ productId, options, variants, onChanged }) {
  const { token } = useAuth();
  const [optionsDraft, setOptionsDraft] = useState(() => JSON.stringify(options, null, 2) === '[]' ? [] : options);
  const [savingOptions, setSavingOptions] = useState(false);
  const [newVariant, setNewVariant] = useState({ sku: '', price: '0', stock: '0' });
  const [busyVariantId, setBusyVariantId] = useState(null);

  function updateOption(index, patch) {
    setOptionsDraft((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  async function saveOptions() {
    setSavingOptions(true);
    try {
      await api.putProductOptions(token, productId, optionsDraft);
      toast.success('Options saved.');
      onChanged();
    } catch (err) {
      toast.error(err.message ?? 'Failed to save options.');
    } finally {
      setSavingOptions(false);
    }
  }

  async function addVariant(e) {
    e.preventDefault();
    try {
      await api.createVariant(token, productId, {
        sku: newVariant.sku || undefined,
        price: Number(newVariant.price) || 0,
        stock: Number(newVariant.stock) || 0,
      });
      setNewVariant({ sku: '', price: '0', stock: '0' });
      toast.success('Variant added.');
      onChanged();
    } catch (err) {
      toast.error(err.message ?? 'Failed to add variant.');
    }
  }

  async function patchVariantField(variantId, patch) {
    setBusyVariantId(variantId);
    try {
      await api.patchVariant(token, productId, variantId, patch);
      onChanged();
    } catch (err) {
      toast.error(err.message ?? 'Failed to update variant.');
    } finally {
      setBusyVariantId(null);
    }
  }

  async function adjustStock(variantId, delta) {
    setBusyVariantId(variantId);
    try {
      await api.adjustStock(token, productId, variantId, { delta, reason: 'Manual adjustment (admin)' });
      onChanged();
    } catch (err) {
      toast.error(err.message ?? 'Failed to adjust stock.');
    } finally {
      setBusyVariantId(null);
    }
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Options</h3>
          <button
            type="button"
            onClick={() => setOptionsDraft((prev) => [...prev, { name: '', vals: [''], position: prev.length }])}
            className="text-sm font-medium text-blue-700 hover:underline"
          >
            + Add option
          </button>
        </div>
        {optionsDraft.length === 0 && (
          <p className="mt-1 text-sm text-gray-500">
            No options yet (e.g. Size, Colour). Simple products with one variant don&apos;t need any.
          </p>
        )}
        <div className="mt-2 space-y-2">
          {optionsDraft.map((opt, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2 rounded border border-gray-200 p-2">
              <input
                value={opt.name}
                onChange={(e) => updateOption(index, { name: e.target.value })}
                placeholder="Option name (e.g. Size)"
                className={`${inputClass} w-40`}
              />
              <input
                value={opt.vals.join(', ')}
                onChange={(e) => updateOption(index, { vals: e.target.value.split(',').map((v) => v.trim()).filter(Boolean) })}
                placeholder="Values, comma separated"
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => setOptionsDraft((prev) => prev.filter((_, i) => i !== index))}
                className="text-xs font-medium text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        {optionsDraft.length > 0 && (
          <button
            type="button"
            disabled={savingOptions}
            onClick={saveOptions}
            className="mt-2 rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            {savingOptions ? 'Saving…' : 'Save options'}
          </button>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900">Variants</h3>
        <div className="mt-2 overflow-x-auto rounded border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600">SKU</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Options</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Price</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Sale price</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Stock</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Default</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {variants.map((v) => (
                <tr key={v.id} className={busyVariantId === v.id ? 'opacity-50' : ''}>
                  <td className="px-3 py-2">
                    <input
                      defaultValue={v.sku ?? ''}
                      onBlur={(e) => e.target.value !== (v.sku ?? '') && patchVariantField(v.id, { sku: e.target.value || null })}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {Object.entries(v.opts ?? {}).map(([k, val]) => `${k}: ${val}`).join(', ') || '—'}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={v.price}
                      onBlur={(e) => Number(e.target.value) !== v.price && patchVariantField(v.id, { price: Number(e.target.value) })}
                      className={`${inputClass} w-24`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      step="0.01"
                      defaultValue={v.salePrice ?? ''}
                      onBlur={(e) =>
                        patchVariantField(v.id, { salePrice: e.target.value === '' ? null : Number(e.target.value) })
                      }
                      className={`${inputClass} w-24`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => adjustStock(v.id, -1)}
                        disabled={v.stock <= 0}
                        className="rounded border border-gray-300 px-2 disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-10 text-center">{v.stock}</span>
                      <button
                        type="button"
                        onClick={() => adjustStock(v.id, 1)}
                        className="rounded border border-gray-300 px-2"
                      >
                        +
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="defaultVariant"
                      checked={v.isDefault === 1}
                      onChange={() => patchVariantField(v.id, { isDefault: 1 })}
                      aria-label={`Make ${v.sku ?? v.id} the default variant`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <ConfirmButton
                      label="Remove"
                      confirmTitle="Remove this variant?"
                      confirmMessage="This deletes the variant and its stock history. This cannot be undone."
                      onConfirm={async () => {
                        await api.deleteVariant(token, productId, v.id);
                        onChanged();
                      }}
                      className="text-xs font-medium text-red-600 hover:underline"
                      disabled={variants.length <= 1}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addVariant} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600">New SKU</label>
            <input
              value={newVariant.sku}
              onChange={(e) => setNewVariant((v) => ({ ...v, sku: e.target.value }))}
              className={`${inputClass} w-32`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Price</label>
            <input
              type="number"
              step="0.01"
              value={newVariant.price}
              onChange={(e) => setNewVariant((v) => ({ ...v, price: e.target.value }))}
              className={`${inputClass} w-24`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600">Stock</label>
            <input
              type="number"
              value={newVariant.stock}
              onChange={(e) => setNewVariant((v) => ({ ...v, stock: e.target.value }))}
              className={`${inputClass} w-20`}
            />
          </div>
          <button
            type="submit"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add variant
          </button>
        </form>
      </section>
    </div>
  );
}
