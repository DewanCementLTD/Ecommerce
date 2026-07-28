import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

/**
 * Per-field translation editor shared by products, categories, and pages.
 * `defaultValues` is the entity's own row (the default-language source of truth) —
 * a missing translation shows that value greyed out as a placeholder, matching the
 * fallback rule in docs/02-PHASE-1-catalog.md Task 5.
 */
export function TranslationsPanel({ entity, entityId, fieldsConfig, defaultValues }) {
  const { token } = useAuth();
  const [langs, setLangs] = useState([]);
  const [translations, setTranslations] = useState({});
  const [lang, setLang] = useState('');
  const [draft, setDraft] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [langsRes, transRes] = await Promise.all([
        api.listLangs(token),
        entityId ? api.getTranslations(token, entity, entityId) : Promise.resolve({ translations: {} }),
      ]);
      const nonDefault = langsRes.rows.filter((l) => !l.isDefault && l.isActive);
      setLangs(nonDefault);
      setTranslations(transRes.translations ?? {});
      if (!lang && nonDefault.length > 0) setLang(nonDefault[0].code);
    } catch (err) {
      toast.error(err.message ?? 'Failed to load translations.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, entity, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setDraft(translations[lang] ?? {});
  }, [lang, translations]);

  async function save() {
    setSaving(true);
    try {
      const res = await api.putTranslations(token, entity, entityId, lang, draft);
      setTranslations(res.translations ?? {});
      toast.success('Translation saved.');
    } catch (err) {
      toast.error(err.message ?? 'Failed to save translation.');
    } finally {
      setSaving(false);
    }
  }

  if (!entityId) {
    return <p className="text-sm text-gray-500">Save this item first, then come back to translate it.</p>;
  }
  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (langs.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        Only one language is enabled for this store. Add more under Settings to translate content.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="translation-lang" className="block text-xs font-medium text-gray-600">
          Language
        </label>
        <select
          id="translation-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          className="mt-1 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {langs.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>
      </div>

      {fieldsConfig.map((field) => {
        const fallback = defaultValues?.[field.key] ?? '';
        const value = draft[field.key] ?? '';
        const Tag = field.multiline ? 'textarea' : 'input';
        return (
          <div key={field.key}>
            <label htmlFor={`tr-${field.key}`} className="block text-sm font-medium text-gray-700">
              {field.label}
            </label>
            <Tag
              id={`tr-${field.key}`}
              rows={field.multiline ? 4 : undefined}
              value={value}
              placeholder={fallback}
              onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            />
            {!value && fallback && (
              <p className="mt-1 text-xs text-gray-400">Showing the default-language value until translated.</p>
            )}
          </div>
        );
      })}

      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {saving ? 'Saving…' : 'Save translation'}
      </button>
    </div>
  );
}
