import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { SortableList, DragHandle } from '../../components/SortableList.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';
import { clampDepths, deriveParentsAndPositions, flattenTree } from '../../lib/outline.js';

const LINK_TYPES = [
  { value: 'url', label: 'External / custom URL' },
  { value: 'cat', label: 'Category' },
  { value: 'coll', label: 'Collection' },
  { value: 'page', label: 'Page' },
  { value: 'product', label: 'Product (by ID)' },
];

export function MenusPage() {
  const { token } = useAuth();
  const [menus, setMenus] = useState([]);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [items, setItems] = useState([]);
  const [refs, setRefs] = useState({ cats: [], colls: [], pages: [] });
  const [newLabel, setNewLabel] = useState('');
  const [newLinkType, setNewLinkType] = useState('url');
  const [newTarget, setNewTarget] = useState('');

  const loadMenus = useCallback(async () => {
    try {
      const res = await api.listMenus(token);
      setMenus(res.rows);
      if (res.rows.length > 0) setActiveMenuId((prev) => prev ?? res.rows[0].id);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load menus.');
    }
  }, [token]);

  const loadItems = useCallback(async () => {
    if (!activeMenuId) return;
    try {
      const res = await api.listMenuItems(token, activeMenuId);
      setItems(flattenTree(res.items));
    } catch (err) {
      toast.error(err.message ?? 'Failed to load menu items.');
    }
  }, [token, activeMenuId]);

  useEffect(() => {
    loadMenus();
    api
      .getCatTree(token)
      .then((res) => setRefs((r) => ({ ...r, cats: flattenTree(res.tree) })))
      .catch(() => {});
    api
      .listColls(token, { pageSize: 100 })
      .then((res) => setRefs((r) => ({ ...r, colls: res.rows })))
      .catch(() => {});
    api
      .listPages(token)
      .then((res) => setRefs((r) => ({ ...r, pages: res.rows })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  async function persist(nextItems) {
    const withParents = deriveParentsAndPositions(clampDepths(nextItems));
    setItems(withParents);
    try {
      await api.reorderMenuItems(
        token,
        activeMenuId,
        withParents.map((n) => ({ id: n.id, position: n.position, parentId: n.parentId })),
      );
    } catch (err) {
      toast.error(err.message ?? 'Failed to save the new order — reverting.');
      loadItems();
    }
  }

  function indent(index) {
    if (index === 0 || items[index - 1].depth < items[index].depth) return;
    const next = [...items];
    next[index] = { ...next[index], depth: next[index].depth + 1 };
    persist(next);
  }

  function outdent(index) {
    if (items[index].depth === 0) return;
    const next = [...items];
    next[index] = { ...next[index], depth: next[index].depth - 1 };
    persist(next);
  }

  async function addItem(e) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    try {
      await api.createMenuItem(token, activeMenuId, {
        label: newLabel.trim(),
        linkType: newLinkType,
        url: newLinkType === 'url' ? newTarget : undefined,
        linkId: newLinkType !== 'url' ? Number(newTarget) : undefined,
      });
      setNewLabel('');
      setNewTarget('');
      toast.success('Menu item added.');
      loadItems();
    } catch (err) {
      toast.error(err.message ?? 'Failed to add menu item.');
    }
  }

  async function updateItem(id, patch) {
    try {
      await api.patchMenuItem(token, id, patch);
      loadItems();
    } catch (err) {
      toast.error(err.message ?? 'Failed to update menu item.');
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Menus</h1>

      <div className="flex gap-2 border-b border-gray-200">
        {menus.map((menu) => (
          <button
            key={menu.id}
            type="button"
            onClick={() => setActiveMenuId(menu.id)}
            className={`px-3 py-2 text-sm font-medium ${
              activeMenuId === menu.id ? 'border-b-2 border-blue-600 text-blue-700' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {menu.name} ({menu.code})
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500">No items yet — add one below.</p>
      ) : (
        <SortableList
          items={items}
          onReorder={persist}
          renderItem={(item, handleProps) => {
            const index = items.findIndex((n) => n.id === item.id);
            return (
              <div
                className="flex flex-wrap items-center gap-2 rounded border border-gray-200 bg-white p-2"
                style={{ paddingInlineStart: 8 + item.depth * 24 }}
              >
                <DragHandle {...handleProps} />
                <div className="flex flex-col">
                  <button type="button" onClick={() => outdent(index)} disabled={item.depth === 0} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => indent(index)}
                    disabled={index === 0 || items[index - 1].depth < item.depth}
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    ▶
                  </button>
                </div>
                <input
                  defaultValue={item.label}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== item.label && updateItem(item.id, { label: e.target.value.trim() })}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
                />
                <span className="text-xs text-gray-500">
                  {item.linkType === 'url' ? item.url : `${item.linkType}#${item.linkId}`}
                </span>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={!!item.isActive}
                    onChange={(e) => updateItem(item.id, { isActive: e.target.checked ? 1 : 0 })}
                  />
                  On
                </label>
                <ConfirmButton
                  label="Delete"
                  confirmTitle={`Delete "${item.label}"?`}
                  confirmMessage="This removes the menu item and anything nested under it."
                  onConfirm={async () => {
                    await api.deleteMenuItem(token, item.id);
                    loadItems();
                  }}
                  className="text-xs font-medium text-red-600 hover:underline"
                />
              </div>
            );
          }}
        />
      )}

      <form onSubmit={addItem} className="space-y-2 rounded border border-gray-200 p-3">
        <p className="text-sm font-medium text-gray-700">Add menu item</p>
        <div className="flex flex-wrap gap-2">
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label"
            className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
          <select
            value={newLinkType}
            onChange={(e) => {
              setNewLinkType(e.target.value);
              setNewTarget('');
            }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            {LINK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {newLinkType === 'url' && (
            <input value={newTarget} onChange={(e) => setNewTarget(e.target.value)} placeholder="/cats/example" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          )}
          {newLinkType === 'cat' && (
            <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Choose a category</option>
              {refs.cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {newLinkType === 'coll' && (
            <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Choose a collection</option>
              {refs.colls.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {newLinkType === 'page' && (
            <select value={newTarget} onChange={(e) => setNewTarget(e.target.value)} className="rounded border border-gray-300 px-2 py-1.5 text-sm">
              <option value="">Choose a page</option>
              {refs.pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          {newLinkType === 'product' && (
            <input
              value={newTarget}
              onChange={(e) => setNewTarget(e.target.value)}
              placeholder="Product ID"
              className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          )}
        </div>
        <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          Add
        </button>
      </form>
    </div>
  );
}
