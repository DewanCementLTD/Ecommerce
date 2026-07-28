import { SECTIONS } from '@storeforge/shared';
import { SectionFieldInput } from './SectionFieldInput.jsx';

function isVisible(field, settings) {
  if (!field.showWhen) return true;
  return Object.entries(field.showWhen).every(([key, expected]) => settings[key] === expected);
}

/** Registry-driven settings form — one entry in `shared/sections/registry.js` is the only source of truth. */
export function SectionForm({ type, settings, onChange, refs }) {
  const section = SECTIONS[type];
  if (!section) return <p className="text-sm text-red-600">Unknown section type: {type}</p>;

  function setField(key, value) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="space-y-4">
      {section.help && <p className="text-xs text-gray-500">{section.help}</p>}
      {section.fields.filter((f) => isVisible(f, settings)).map((field) =>
        field.type === 'items' ? (
          <ItemsField key={field.key} field={field} value={settings[field.key] ?? []} onChange={(v) => setField(field.key, v)} refs={refs} />
        ) : (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700">{field.label}</label>
            {field.help && <p className="text-xs text-gray-400">{field.help}</p>}
            <div className="mt-1">
              <SectionFieldInput field={field} value={settings[field.key]} onChange={(v) => setField(field.key, v)} refs={refs} />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function ItemsField({ field, value, onChange, refs }) {
  function updateRow(index, key, val) {
    onChange(value.map((row, i) => (i === index ? { ...row, [key]: val } : row)));
  }
  function addRow() {
    const row = {};
    for (const sub of field.fields) row[sub.key] = sub.default ?? null;
    onChange([...value, row]);
  }
  function removeRow(index) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div>
      <span className="block text-sm font-medium text-gray-700">{field.label}</span>
      <div className="mt-1 space-y-3">
        {value.map((row, index) => (
          <div key={index} className="space-y-2 rounded border border-gray-200 p-2">
            {field.fields.map((sub) => (
              <div key={sub.key}>
                <label className="block text-xs font-medium text-gray-600">{sub.label}</label>
                <SectionFieldInput field={sub} value={row[sub.key]} onChange={(v) => updateRow(index, sub.key, v)} refs={refs} />
              </div>
            ))}
            <button type="button" onClick={() => removeRow(index)} className="text-xs font-medium text-red-600 hover:underline">
              Remove
            </button>
          </div>
        ))}
      </div>
      {value.length < (field.max ?? Infinity) && (
        <button type="button" onClick={addRow} className="mt-2 text-sm font-medium text-blue-700 hover:underline">
          + Add
        </button>
      )}
    </div>
  );
}
