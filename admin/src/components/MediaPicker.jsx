import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from './Modal.jsx';
import { AuthedImage } from './AuthedImage.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

const PAGE_SIZE = 24;

/** Pick an existing image or upload a new one — shared by products, banners, and the section arranger. */
export function MediaPicker({ open, onClose, onSelect }) {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listMedia(token, { page, pageSize: PAGE_SIZE, search: search || undefined });
      setRows(res.rows);
      setTotal(res.total);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load media.');
    } finally {
      setLoading(false);
    }
  }, [token, page, search]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadPct(0);
    try {
      const res = await api.uploadMedia(token, file, setUploadPct);
      toast.success('Uploaded.');
      onSelect(res.media);
      onClose();
    } catch (err) {
      toast.error(err.message ?? 'Upload failed.');
    } finally {
      setUploadPct(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Choose an image" wide>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search filename"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        />
        <label className="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">
          {uploadPct === null ? 'Upload new' : `Uploading… ${uploadPct}%`}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            onChange={handleUpload}
            disabled={uploadPct !== null}
            className="sr-only"
          />
        </label>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">No images yet. Upload one to get started.</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {rows.map((row) => (
            <button
              key={row.ID}
              type="button"
              onClick={() => {
                onSelect(row);
                onClose();
              }}
              className="group aspect-square overflow-hidden rounded border border-gray-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              title={row.FILENAME}
            >
              <AuthedImage
                src={api.mediaUrl(row.ID, 320)}
                alt={row.ALT ?? row.FILENAME}
                className="h-full w-full object-cover transition group-hover:opacity-75"
              />
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
        <span>{total} total</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Next
          </button>
        </div>
      </div>
    </Modal>
  );
}
