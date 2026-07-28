import { useState } from 'react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/AuthContext.jsx';
import { AuthedImage } from '../AuthedImage.jsx';
import { MediaPicker } from '../MediaPicker.jsx';

const inputClass =
  'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

/** One field of a section's settings form, switching on the registry's `field.type`. */
export function SectionFieldInput({ field, value, onChange, refs }) {
  switch (field.type) {
    case 'text':
      return <input value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />;

    case 'textarea':
      return <textarea rows={3} value={value ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass} />;

    case 'html':
      return (
        <textarea
          rows={8}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} font-mono text-xs`}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          min={field.min}
          max={field.max}
          value={value ?? field.default ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
          className={inputClass}
        />
      );

    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          Enabled
        </label>
      );

    case 'select':
      return (
        <select value={value ?? field.default ?? ''} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'media':
      return <SingleMediaField value={value} onChange={onChange} />;

    case 'media_list':
      return <MediaListField value={value ?? []} onChange={onChange} />;

    case 'banner_list':
      return <CheckboxListField value={value ?? []} onChange={onChange} options={refs?.banners ?? []} labelKey="name" />;

    case 'cat_list':
      return <CheckboxListField value={value ?? []} onChange={onChange} options={refs?.cats ?? []} labelKey="name" indentKey="depth" />;

    case 'cat_ref':
      return <RefSelectField value={value} onChange={onChange} options={refs?.cats ?? []} labelKey="name" />;

    case 'coll_ref':
      return <RefSelectField value={value} onChange={onChange} options={refs?.colls ?? []} labelKey="name" />;

    case 'prod_list':
      return <ProductListField value={value ?? []} onChange={onChange} />;

    default:
      return <p className="text-xs text-gray-400">Unsupported field type: {field.type}</p>;
  }
}

function SingleMediaField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <AuthedImage src={api.mediaUrl(value, 96)} alt="" className="h-12 w-12 rounded border border-gray-200 object-cover" />
      ) : (
        <span className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-gray-300 text-xs text-gray-400">
          None
        </span>
      )}
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-blue-700 hover:underline">
        Choose
      </button>
      {value && (
        <button type="button" onClick={() => onChange(null)} className="text-sm text-gray-500 hover:underline">
          Clear
        </button>
      )}
      <MediaPicker open={open} onClose={() => setOpen(false)} onSelect={(media) => onChange(media.ID)} />
    </div>
  );
}

function MediaListField({ value, onChange }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {value.map((mediaId, index) => (
          <div key={`${mediaId}-${index}`} className="relative">
            <AuthedImage src={api.mediaUrl(mediaId, 96)} alt="" className="h-14 w-14 rounded border border-gray-200 object-cover" />
            <button
              type="button"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              aria-label="Remove image"
              className="absolute -right-1.5 -top-1.5 rounded-full bg-white text-red-600 shadow"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => setOpen(true)} className="text-sm font-medium text-blue-700 hover:underline">
        + Add image
      </button>
      <MediaPicker open={open} onClose={() => setOpen(false)} onSelect={(media) => onChange([...value, media.ID])} />
    </div>
  );
}

function CheckboxListField({ value, onChange, options, labelKey, indentKey }) {
  function toggle(id) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }
  if (options.length === 0) return <p className="text-xs text-gray-400">Nothing to choose from yet.</p>;
  return (
    <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-gray-200 p-2">
      {options.map((opt) => (
        <label
          key={opt.id}
          className="flex items-center gap-2 text-sm text-gray-700"
          style={indentKey ? { paddingInlineStart: (opt[indentKey] ?? 0) * 16 } : undefined}
        >
          <input type="checkbox" checked={value.includes(opt.id)} onChange={() => toggle(opt.id)} />
          {opt[labelKey]}
        </label>
      ))}
    </div>
  );
}

function RefSelectField({ value, onChange, options, labelKey }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={inputClass}
    >
      <option value="">None</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt[labelKey]}
        </option>
      ))}
    </select>
  );
}

function ProductListField({ value, onChange }) {
  const { token } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [names, setNames] = useState({});

  async function search(e) {
    e.preventDefault();
    if (!term.trim()) return;
    const res = await api.listProducts(token, { search: term, pageSize: 10 });
    setResults(res.rows.filter((p) => !value.includes(p.id)));
    setNames((prev) => ({ ...prev, ...Object.fromEntries(res.rows.map((p) => [p.id, p.name])) }));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
            {names[id] ?? `#${id}`}
            <button type="button" onClick={() => onChange(value.filter((v) => v !== id))} aria-label="Remove">
              ✕
            </button>
          </span>
        ))}
      </div>
      <form onSubmit={search} className="flex gap-2">
        <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search products" className={inputClass} />
        <button type="submit" className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700 hover:bg-gray-100">
          Search
        </button>
      </form>
      {results.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded border border-gray-200 text-sm">
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-2 py-1">
              {p.name}
              <button
                type="button"
                onClick={() => {
                  onChange([...value, p.id]);
                  setResults((r) => r.filter((x) => x.id !== p.id));
                }}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
