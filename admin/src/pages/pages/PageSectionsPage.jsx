import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { SECTION_TYPES, SECTIONS, defaultSettings } from '@storeforge/shared';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { SortableList, DragHandle } from '../../components/SortableList.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';
import { Modal } from '../../components/Modal.jsx';
import { SectionForm } from '../../components/sections/SectionForm.jsx';
import { SectionPreview } from '../../components/sections/SectionPreview.jsx';

function flattenCats(nodes, depth = 0) {
  return nodes.flatMap((n) => [{ id: n.id, name: n.name, depth }, ...flattenCats(n.children ?? [], depth + 1)]);
}

export function PageSectionsPage() {
  const { id } = useParams();
  const { token } = useAuth();
  const [page, setPage] = useState(null);
  const [sections, setSections] = useState([]);
  const [refs, setRefs] = useState({ cats: [], colls: [], banners: [] });
  const [loading, setLoading] = useState(true);
  const [newType, setNewType] = useState(SECTION_TYPES[0]);
  const [editingSection, setEditingSection] = useState(null);
  const [editingSettings, setEditingSettings] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pageRes, sectionsRes, catsRes, collsRes, bannersRes] = await Promise.all([
        api.getPage(token, id),
        api.listSections(token, id),
        api.getCatTree(token),
        api.listColls(token, { pageSize: 100 }),
        api.listBanners(token),
      ]);
      setPage(pageRes.page);
      setSections(sectionsRes.rows);
      setRefs({ cats: flattenCats(catsRes.tree), colls: collsRes.rows, banners: bannersRes.rows });
    } catch (err) {
      toast.error(err.message ?? 'Failed to load page.');
    } finally {
      setLoading(false);
    }
  }, [token, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function persistOrder(nextSections) {
    setSections(nextSections);
    try {
      await api.reorderSections(
        token,
        id,
        nextSections.map((s, index) => ({ id: s.id, position: index })),
      );
    } catch (err) {
      toast.error(err.message ?? 'Failed to save the new order — reverting.');
      load();
    }
  }

  async function toggleActive(section) {
    const nextActive = section.isActive ? 0 : 1;
    setSections((prev) => prev.map((s) => (s.id === section.id ? { ...s, isActive: nextActive } : s)));
    try {
      await api.patchSection(token, section.id, { isActive: nextActive });
    } catch (err) {
      toast.error(err.message ?? 'Failed to update section.');
      load();
    }
  }

  async function addSection(e) {
    e.preventDefault();
    try {
      await api.createSection(token, id, { type: newType, settings: defaultSettings(newType) });
      toast.success('Section added.');
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to add section.');
    }
  }

  function openEditor(section) {
    setEditingSection(section);
    setEditingSettings(section.settings);
  }

  async function saveEditor() {
    try {
      const res = await api.patchSection(token, editingSection.id, { settings: editingSettings });
      setSections(res.rows);
      toast.success('Section saved.');
      setEditingSection(null);
    } catch (err) {
      toast.error(err.message ?? 'Failed to save section.');
    }
  }

  if (loading || !page) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">{page.title}</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Sections</h2>
          {sections.length === 0 ? (
            <p className="text-sm text-gray-500">No sections yet — add one below.</p>
          ) : (
            <SortableList
              items={sections}
              onReorder={persistOrder}
              renderItem={(section, handleProps) => (
                <div className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2">
                  <DragHandle {...handleProps} />
                  <span className="flex-1 text-sm font-medium text-gray-800">
                    {SECTIONS[section.type]?.label ?? section.type}
                  </span>
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={!!section.isActive} onChange={() => toggleActive(section)} />
                    On
                  </label>
                  <button
                    type="button"
                    onClick={() => openEditor(section)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    Edit
                  </button>
                  <ConfirmButton
                    label="Delete"
                    confirmTitle="Remove this section?"
                    confirmMessage="This removes it from the page. This cannot be undone."
                    onConfirm={async () => {
                      await api.deleteSection(token, section.id);
                      toast.success('Section removed.');
                      load();
                    }}
                    className="text-xs font-medium text-red-600 hover:underline"
                  />
                </div>
              )}
            />
          )}

          <form onSubmit={addSection} className="flex gap-2 pt-2">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm"
            >
              {SECTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SECTIONS[t].label}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
              Add section
            </button>
          </form>
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-900">Preview</h2>
          <div className="mt-2 rounded border border-gray-200 bg-gray-50 p-3">
            <SectionPreview sections={sections} refs={refs} />
          </div>
        </div>
      </div>

      <Modal
        open={!!editingSection}
        onClose={() => setEditingSection(null)}
        title={editingSection ? SECTIONS[editingSection.type]?.label ?? editingSection.type : ''}
        wide
      >
        {editingSection && (
          <div className="space-y-4">
            <SectionForm type={editingSection.type} settings={editingSettings} onChange={setEditingSettings} refs={refs} />
            <button
              type="button"
              onClick={saveEditor}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Save changes
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
