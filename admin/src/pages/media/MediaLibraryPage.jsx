import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { AuthedImage } from '../../components/AuthedImage.jsx';
import { ConfirmButton } from '../../components/ConfirmButton.jsx';
import { Modal } from '../../components/Modal.jsx';

const PAGE_SIZE = 30;

export function MediaLibraryPage() {
  const { token } = useAuth();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadPct, setUploadPct] = useState(null);
  const [detail, setDetail] = useState(null);
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
    load();
  }, [load]);

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadPct(0);
    try {
      await api.uploadMedia(token, file, setUploadPct);
      toast.success('Uploaded.');
      setPage(1);
      load();
    } catch (err) {
      toast.error(err.message ?? 'Upload failed.');
    } finally {
      setUploadPct(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function saveAlt(id, alt) {
    try {
      await api.patchMedia(token, id, { alt });
      toast.success('Saved.');
      setRows((prev) => prev.map((r) => (r.ID === id ? { ...r, ALT: alt } : r)));
      setDetail((d) => (d && d.ID === id ? { ...d, ALT: alt } : d));
    } catch (err) {
      toast.error(err.message ?? 'Failed to save.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold text-gray-900">Media</h1>
        <label className="cursor-pointer rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {uploadPct === null ? 'Upload' : `Uploading… ${uploadPct}%`}
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

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">No images yet. Upload one to get started.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {rows.map((row) => (
            <button
              key={row.ID}
              type="button"
              onClick={() => setDetail(row)}
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

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>{total} total</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-gray-300 px-3 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.FILENAME ?? ''}>
        {detail && (
          <div className="space-y-3">
            <AuthedImage src={api.mediaUrl(detail.ID)} alt={detail.ALT ?? ''} className="w-full rounded object-contain" />
            <dl className="grid grid-cols-2 gap-1 text-xs text-gray-500">
              <dt>Dimensions</dt>
              <dd>{detail.WIDTH && detail.HEIGHT ? `${detail.WIDTH}×${detail.HEIGHT}` : '—'}</dd>
              <dt>Size</dt>
              <dd>{detail.SIZE_BYTES ? `${Math.round(detail.SIZE_BYTES / 1024)} KB` : '—'}</dd>
            </dl>
            <div>
              <label htmlFor="alt" className="block text-sm font-medium text-gray-700">
                Alt text
              </label>
              <input
                id="alt"
                defaultValue={detail.ALT ?? ''}
                onBlur={(e) => e.target.value !== (detail.ALT ?? '') && saveAlt(detail.ID, e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <ConfirmButton
              label="Delete image"
              confirmTitle="Delete this image?"
              confirmMessage="This removes it from the media library. If it's used on a product or banner, that reference will break."
              onConfirm={async () => {
                await api.deleteMedia(token, detail.ID);
                toast.success('Deleted.');
                setDetail(null);
                load();
              }}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
