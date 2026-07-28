import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { SortableList, DragHandle } from '../../components/SortableList.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';

function flatten(nodes, depth = 0) {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, isActive: node.isActive, depth },
    ...flatten(node.children ?? [], depth + 1),
  ]);
}

/** Clamp depths so drag/indent never produces an impossible jump (e.g. depth +2 in one step). */
function clampDepths(nodes) {
  let prevDepth = -1;
  return nodes.map((n) => {
    const depth = Math.min(n.depth, prevDepth + 1);
    prevDepth = depth;
    return { ...n, depth };
  });
}

/** Standard outliner rule: a node's parent is the nearest preceding node one level shallower. */
function deriveParentsAndPositions(nodes) {
  const stack = [];
  const siblingCount = new Map();
  return nodes.map((node) => {
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    const key = parent ? parent.id : 'root';
    const position = siblingCount.get(key) ?? 0;
    siblingCount.set(key, position + 1);
    stack.push({ depth: node.depth, id: node.id });
    return { ...node, parentId: parent ? parent.id : null, position };
  });
}

export function CategoriesPage() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getCatTree(token);
      setItems(flatten(res.tree));
    } catch (err) {
      toast.error(err.message ?? 'Failed to load categories.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function persist(nextItems) {
    const withParents = deriveParentsAndPositions(clampDepths(nextItems));
    setItems(withParents);
    try {
      await api.reorderCats(
        token,
        withParents.map((n) => ({ id: n.id, position: n.position, parentId: n.parentId })),
      );
    } catch (err) {
      toast.error(err.message ?? 'Failed to save the new order — reverting.');
      load();
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

  async function rename(id, name) {
    try {
      await api.patchCat(token, id, { name });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, name } : n)));
    } catch (err) {
      toast.error(err.message ?? 'Failed to rename category.');
    }
  }

  async function toggleActive(id, isActive) {
    try {
      await api.patchCat(token, id, { isActive: isActive ? 1 : 0 });
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isActive: isActive ? 1 : 0 } : n)));
    } catch (err) {
      toast.error(err.message ?? 'Failed to update category.');
    }
  }

  async function createCategory(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.createCat(token, { name: newName.trim() });
      setNewName('');
      toast.success('Category created.');
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to create category.');
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Categories</h1>
      <p className="text-sm text-gray-500">
        Drag to reorder. Use the arrows to nest a category under the one above it.
      </p>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-500">No categories yet — add one below.</p>
      ) : (
        <SortableList
          items={items}
          onReorder={persist}
          renderItem={(node, handleProps) => {
            const index = items.findIndex((n) => n.id === node.id);
            return (
              <div
                className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2"
                style={{ paddingInlineStart: 8 + node.depth * 24 }}
              >
                <DragHandle {...handleProps} />
                <div className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => outdent(index)}
                    disabled={node.depth === 0}
                    aria-label="Outdent"
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    ◀
                  </button>
                  <button
                    type="button"
                    onClick={() => indent(index)}
                    disabled={index === 0 || items[index - 1].depth < node.depth}
                    aria-label="Indent"
                    className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  >
                    ▶
                  </button>
                </div>
                <input
                  defaultValue={node.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== node.name && rename(node.id, e.target.value.trim())}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                />
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={node.isActive === 1}
                    onChange={(e) => toggleActive(node.id, e.target.checked)}
                  />
                  Active
                </label>
                <ConfirmButton
                  label="Delete"
                  confirmTitle={`Delete "${node.name}"?`}
                  confirmMessage="This removes the category. Products in it are not deleted, just uncategorized here."
                  onConfirm={async () => {
                    await api.deleteCat(token, node.id);
                    toast.success('Category deleted.');
                    load();
                  }}
                  className="text-xs font-medium text-red-600 hover:underline"
                />
              </div>
            );
          }}
        />
      )}

      <form onSubmit={createCategory} className="flex gap-2 pt-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New top-level category"
          className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add
        </button>
      </form>
    </div>
  );
}
