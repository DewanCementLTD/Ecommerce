import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';
import { ProductVariants } from './ProductVariants.jsx';
import { ProductImages } from './ProductImages.jsx';
import { TranslationsPanel } from '../../components/TranslationsPanel.jsx';

const EMPTY_FORM = {
  name: '',
  descr: '',
  shortDesc: '',
  brand: '',
  isActive: 1,
  isFeatured: 0,
  tags: '',
  metaTitle: '',
  metaDesc: '',
  catIds: [],
};

function flattenTree(nodes, depth = 0) {
  return nodes.flatMap((node) => [{ ...node, depth }, ...flattenTree(node.children ?? [], depth + 1)]);
}

const TRANSLATION_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'shortDesc', label: 'Short description', multiline: true },
  { key: 'descr', label: 'Description', multiline: true },
  { key: 'metaTitle', label: 'Meta title' },
  { key: 'metaDesc', label: 'Meta description', multiline: true },
];

export function ProductEditorPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { token } = useAuth();

  const [product, setProduct] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [catTree, setCatTree] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!isNew);

  const load = useCallback(
    async (optimistic) => {
      if (optimistic?.optimisticImages) {
        setProduct((p) => (p ? { ...p, images: optimistic.optimisticImages } : p));
        return;
      }
      if (isNew) return;
      try {
        const res = await api.getProduct(token, id);
        setProduct(res.product);
        setForm({
          name: res.product.name,
          descr: res.product.descr ?? '',
          shortDesc: res.product.shortDesc ?? '',
          brand: res.product.brand ?? '',
          isActive: res.product.isActive,
          isFeatured: res.product.isFeatured,
          tags: (res.product.tags ?? []).join(', '),
          metaTitle: res.product.metaTitle ?? '',
          metaDesc: res.product.metaDesc ?? '',
          catIds: res.product.catIds ?? [],
        });
      } catch (err) {
        setError(err.message ?? 'Failed to load product.');
      } finally {
        setLoading(false);
      }
    },
    [token, id, isNew],
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .getCatTree(token)
      .then((res) => setCatTree(flattenTree(res.tree)))
      .catch(() => {});
  }, [token]);

  function toggleCat(catId) {
    setForm((f) => ({
      ...f,
      catIds: f.catIds.includes(catId) ? f.catIds.filter((c) => c !== catId) : [...f.catIds, catId],
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const body = {
      name: form.name,
      descr: form.descr || null,
      shortDesc: form.shortDesc || null,
      brand: form.brand || null,
      isActive: form.isActive,
      isFeatured: form.isFeatured,
      tags: form.tags
        ? form.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [],
      metaTitle: form.metaTitle || null,
      metaDesc: form.metaDesc || null,
      catIds: form.catIds,
    };
    try {
      if (isNew) {
        const res = await api.createProduct(token, body);
        toast.success('Product created.');
        navigate(`/products/${res.product.id}`, { replace: true });
      } else {
        const res = await api.patchProduct(token, id, body);
        setProduct(res.product);
        toast.success('Changes saved.');
      }
    } catch (err) {
      setError(err.message ?? 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">{isNew ? 'New product' : form.name}</h1>
        {!isNew && (
          <ConfirmButton
            label="Delete product"
            confirmTitle="Delete this product?"
            confirmMessage={`This permanently deletes "${form.name}", its variants, and its images. This cannot be undone.`}
            onConfirm={async () => {
              await api.deleteProduct(token, id);
              toast.success('Product deleted.');
              navigate('/products', { replace: true });
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
        <h2 className="text-sm font-semibold text-gray-900">Details</h2>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            id="name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="shortDesc" className="block text-sm font-medium text-gray-700">
            Short description
          </label>
          <input
            id="shortDesc"
            value={form.shortDesc}
            onChange={(e) => setForm((f) => ({ ...f, shortDesc: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="descr" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="descr"
            rows={5}
            value={form.descr}
            onChange={(e) => setForm((f) => ({ ...f, descr: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="brand" className="block text-sm font-medium text-gray-700">
              Brand
            </label>
            <input
              id="brand"
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="tags" className="block text-sm font-medium text-gray-700">
              Tags (comma separated)
            </label>
            <input
              id="tags"
              value={form.tags}
              onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>
        </div>
        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isActive === 1}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked ? 1 : 0 }))}
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.isFeatured === 1}
              onChange={(e) => setForm((f) => ({ ...f, isFeatured: e.target.checked ? 1 : 0 }))}
            />
            Featured
          </label>
        </div>

        <h2 className="pt-2 text-sm font-semibold text-gray-900">Categories</h2>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
          {catTree.length === 0 && <p className="text-sm text-gray-500">No categories yet.</p>}
          {catTree.map((cat) => (
            <label key={cat.id} className="flex items-center gap-2 text-sm text-gray-700" style={{ paddingInlineStart: cat.depth * 16 }}>
              <input type="checkbox" checked={form.catIds.includes(cat.id)} onChange={() => toggleCat(cat.id)} />
              {cat.name}
            </label>
          ))}
        </div>

        <h2 className="pt-2 text-sm font-semibold text-gray-900">SEO</h2>
        <div>
          <label htmlFor="metaTitle" className="block text-sm font-medium text-gray-700">
            Meta title
          </label>
          <input
            id="metaTitle"
            value={form.metaTitle}
            onChange={(e) => setForm((f) => ({ ...f, metaTitle: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="metaDesc" className="block text-sm font-medium text-gray-700">
            Meta description
          </label>
          <textarea
            id="metaDesc"
            rows={2}
            value={form.metaDesc}
            onChange={(e) => setForm((f) => ({ ...f, metaDesc: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
        </button>
      </form>

      {!isNew && product && (
        <>
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <ProductVariants
              productId={product.id}
              options={product.options}
              variants={product.variants}
              onChanged={load}
            />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <ProductImages productId={product.id} images={product.images} onChanged={load} />
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">Translations</h3>
            <TranslationsPanel
              entity="product"
              entityId={product.id}
              fieldsConfig={TRANSLATION_FIELDS}
              defaultValues={form}
            />
          </section>
        </>
      )}
    </div>
  );
}
