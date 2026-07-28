import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { AuthedImage } from '../../components/AuthedImage.jsx';
import { MediaPicker } from '../../components/MediaPicker.jsx';

const FIELDS = [
  { key: 'seo_title', label: 'Store name (SEO title)' },
  { key: 'seo_description', label: 'SEO description', multiline: true },
  { key: 'currency_label', label: 'Currency label', help: 'e.g. USD, EGP — display only, no conversion.' },
  { key: 'contact_email', label: 'Contact email' },
  { key: 'contact_phone', label: 'Contact phone' },
  { key: 'social_facebook', label: 'Facebook URL' },
  { key: 'social_instagram', label: 'Instagram URL' },
];

export function SettingsPage() {
  const { token } = useAuth();
  const [values, setValues] = useState({});
  const [logoMediaId, setLogoMediaId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.getSettings(token);
      setValues(res.settings);
      setLogoMediaId(res.settings.logo_media_id ? Number(res.settings.logo_media_id) : null);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load settings.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      await api.putSettings(token, { ...values, logo_media_id: logoMediaId ? String(logoMediaId) : '' });
      toast.success('Settings saved.');
    } catch (err) {
      toast.error(err.message ?? 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-gray-500">Loading…</p>;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Settings</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <span className="block text-sm font-medium text-gray-700">Logo</span>
        <div className="mt-1 flex items-center gap-3">
          <AuthedImage
            src={logoMediaId ? api.mediaUrl(logoMediaId, 96) : null}
            alt=""
            className="h-14 w-14 rounded border border-gray-200 object-contain"
            fallback={<span className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">None</span>}
          />
          <button type="button" onClick={() => setPickerOpen(true)} className="text-sm font-medium text-blue-700 hover:underline">
            Choose
          </button>
          {logoMediaId && (
            <button type="button" onClick={() => setLogoMediaId(null)} className="text-sm text-gray-500 hover:underline">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
        {FIELDS.map((field) => (
          <div key={field.key}>
            <label htmlFor={field.key} className="block text-sm font-medium text-gray-700">
              {field.label}
            </label>
            {field.help && <p className="text-xs text-gray-400">{field.help}</p>}
            {field.multiline ? (
              <textarea
                id={field.key}
                rows={3}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            ) : (
              <input
                id={field.key}
                value={values[field.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [field.key]: e.target.value }))}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              />
            )}
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save changes'}
      </button>

      <MediaPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onSelect={(media) => setLogoMediaId(media.ID)} />
    </div>
  );
}
