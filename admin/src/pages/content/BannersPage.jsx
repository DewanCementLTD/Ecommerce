import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { AuthedImage } from '../../components/AuthedImage.jsx';
import { MediaPicker } from '../../components/MediaPicker.jsx';
import { Modal } from '../../components/Modal.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';

const EMPTY = { name: '', mediaId: null, mediaMobileId: null, link: '', alt: '', isActive: 1 };

export function BannersPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // { id?, ...fields }
  const [pickerFor, setPickerFor] = useState(null); // 'mediaId' | 'mediaMobileId' | null

  const load = useCallback(async () => {
    try {
      const res = await api.listBanners(token);
      setRows(res.rows);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load banners.');
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    const body = {
      name: editing.name,
      mediaId: editing.mediaId,
      mediaMobileId: editing.mediaMobileId,
      link: editing.link || null,
      alt: editing.alt || null,
      isActive: editing.isActive,
    };
    try {
      if (editing.id) {
        await api.patchBanner(token, editing.id, body);
      } else {
        await api.createBanner(token, body);
      }
      toast.success('Banner saved.');
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message ?? 'Failed to save banner.');
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Banners</h1>
        <button
          type="button"
          onClick={() => setEditing({ ...EMPTY })}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New banner
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setEditing(b)}
            className="overflow-hidden rounded border border-gray-200 bg-white text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <AuthedImage
              src={b.mediaId ? api.mediaUrl(b.mediaId, 320) : null}
              alt=""
              className="h-24 w-full object-cover"
              fallback={<div className="flex h-24 w-full items-center justify-center bg-gray-100 text-xs text-gray-400">No image</div>}
            />
            <div className="p-2">
              <p className="truncate text-sm font-medium text-gray-800">{b.name}</p>
              <span className={`text-xs ${b.isActive ? 'text-green-700' : 'text-gray-500'}`}>
                {b.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </button>
        ))}
        {rows.length === 0 && <p className="col-span-full text-sm text-gray-500">No banners yet.</p>}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Edit banner' : 'New banner'}>
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                value={editing.name}
                onChange={(e) => setEditing((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-4">
              <div>
                <span className="block text-sm font-medium text-gray-700">Image (desktop)</span>
                <div className="mt-1 flex items-center gap-2">
                  <AuthedImage
                    src={editing.mediaId ? api.mediaUrl(editing.mediaId, 96) : null}
                    alt=""
                    className="h-14 w-14 rounded border border-gray-200 object-cover"
                    fallback={<span className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">None</span>}
                  />
                  <button type="button" onClick={() => setPickerFor('mediaId')} className="text-sm font-medium text-blue-700 hover:underline">
                    Choose
                  </button>
                </div>
              </div>
              <div>
                <span className="block text-sm font-medium text-gray-700">Image (mobile)</span>
                <div className="mt-1 flex items-center gap-2">
                  <AuthedImage
                    src={editing.mediaMobileId ? api.mediaUrl(editing.mediaMobileId, 96) : null}
                    alt=""
                    className="h-14 w-14 rounded border border-gray-200 object-cover"
                    fallback={<span className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">None</span>}
                  />
                  <button type="button" onClick={() => setPickerFor('mediaMobileId')} className="text-sm font-medium text-blue-700 hover:underline">
                    Choose
                  </button>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Link</label>
              <input
                value={editing.link ?? ''}
                onChange={(e) => setEditing((f) => ({ ...f, link: e.target.value }))}
                placeholder="/cats/example"
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Alt text</label>
              <input
                value={editing.alt ?? ''}
                onChange={(e) => setEditing((f) => ({ ...f, alt: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={editing.isActive === 1}
                onChange={(e) => setEditing((f) => ({ ...f, isActive: e.target.checked ? 1 : 0 }))}
              />
              Active
            </label>
            <div className="flex items-center justify-between pt-2">
              {editing.id ? (
                <ConfirmButton
                  label="Delete"
                  confirmTitle="Delete this banner?"
                  confirmMessage={`This removes "${editing.name}" from every section that uses it.`}
                  onConfirm={async () => {
                    await api.deleteBanner(token, editing.id);
                    toast.success('Banner deleted.');
                    setEditing(null);
                    load();
                  }}
                />
              ) : (
                <span />
              )}
              <button type="button" onClick={save} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Save
              </button>
            </div>
          </div>
        )}
      </Modal>

      <MediaPicker
        open={!!pickerFor}
        onClose={() => setPickerFor(null)}
        onSelect={(media) => setEditing((f) => ({ ...f, [pickerFor]: media.ID }))}
      />
    </div>
  );
}
