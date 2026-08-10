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
import { RichTextEditor } from '../../components/RichTextEditor.jsx';
import { MediaPicker } from '../../components/MediaPicker.jsx';
import { AuthedImage } from '../../components/AuthedImage.jsx';

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
  const [detailsForm, setDetailsForm] = useState(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [ogPickerOpen, setOgPickerOpen] = useState(false);

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
      setDetailsForm({
        title: pageRes.page.title,
        slug: pageRes.page.slug,
        content: pageRes.page.content ?? '',
        metaTitle: pageRes.page.metaTitle ?? '',
        metaDesc: pageRes.page.metaDesc ?? '',
        ogImageId: pageRes.page.ogImageId ?? null,
        isActive: pageRes.page.isActive,
      });
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

  async function saveDetails(e) {
    e.preventDefault();
    setSavingDetails(true);
    try {
      const res = await api.patchPage(token, id, {
        title: detailsForm.title,
        ...(page.type === 'home' ? {} : { slug: detailsForm.slug }),
        content: detailsForm.content || null,
        metaTitle: detailsForm.metaTitle || null,
        metaDesc: detailsForm.metaDesc || null,
        ogImageId: detailsForm.ogImageId,
        isActive: detailsForm.isActive,
      });
      setPage(res.page);
      toast.success('Page details saved.');
    } catch (err) {
      toast.error(err.message ?? 'Failed to save page details.');
    } finally {
      setSavingDetails(false);
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

  if (loading || !page || !detailsForm) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">{page.title}</h1>

      <form onSubmit={saveDetails} className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Page details</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pageTitle" className="block text-sm font-medium text-gray-700">
              Title
            </label>
            <input
              id="pageTitle"
              required
              value={detailsForm.title}
              onChange={(e) => setDetailsForm((f) => ({ ...f, title: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="pageSlug" className="block text-sm font-medium text-gray-700">
              Slug
            </label>
            <input
              id="pageSlug"
              value={detailsForm.slug}
              disabled={page.type === 'home'}
              onChange={(e) => setDetailsForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="auto-generated from title"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Content</label>
          <p className="text-xs text-gray-400">Freeform body copy for this page — shown above or below its sections, depending on the theme.</p>
          <div className="mt-1">
            <RichTextEditor
              value={detailsForm.content}
              onChange={(html) => setDetailsForm((f) => ({ ...f, content: html }))}
            />
          </div>
        </div>

        <h2 className="pt-2 text-sm font-semibold text-gray-900">SEO</h2>
        <div>
          <label htmlFor="pageMetaTitle" className="block text-sm font-medium text-gray-700">
            Meta title
          </label>
          <input
            id="pageMetaTitle"
            value={detailsForm.metaTitle}
            onChange={(e) => setDetailsForm((f) => ({ ...f, metaTitle: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <label htmlFor="pageMetaDesc" className="block text-sm font-medium text-gray-700">
            Meta description
          </label>
          <textarea
            id="pageMetaDesc"
            rows={2}
            value={detailsForm.metaDesc}
            onChange={(e) => setDetailsForm((f) => ({ ...f, metaDesc: e.target.value }))}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          />
        </div>
        <div>
          <span className="block text-sm font-medium text-gray-700">Social share image</span>
          <div className="mt-1 flex items-center gap-2">
            <AuthedImage
              src={detailsForm.ogImageId ? api.mediaUrl(detailsForm.ogImageId, 96) : null}
              alt=""
              className="h-14 w-14 rounded border border-gray-200 object-cover"
              fallback={
                <span className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">
                  None
                </span>
              }
            />
            <button type="button" onClick={() => setOgPickerOpen(true)} className="text-sm font-medium text-blue-700 hover:underline">
              Choose
            </button>
            {detailsForm.ogImageId && (
              <button
                type="button"
                onClick={() => setDetailsForm((f) => ({ ...f, ogImageId: null }))}
                className="text-sm text-gray-500 hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {page.type !== 'home' && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={detailsForm.isActive === 1}
              onChange={(e) => setDetailsForm((f) => ({ ...f, isActive: e.target.checked ? 1 : 0 }))}
            />
            Active
          </label>
        )}

        <button
          type="submit"
          disabled={savingDetails}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {savingDetails ? 'Saving…' : 'Save page details'}
        </button>
      </form>

      <MediaPicker
        open={ogPickerOpen}
        onClose={() => setOgPickerOpen(false)}
        onSelect={(media) => setDetailsForm((f) => ({ ...f, ogImageId: media.ID }))}
      />

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
