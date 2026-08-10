import { useEffect, useRef } from 'react';

const COMMANDS = [
  { label: 'B', title: 'Bold', command: 'bold', className: 'font-bold' },
  { label: 'I', title: 'Italic', command: 'italic', className: 'italic' },
  { label: 'U', title: 'Underline', command: 'underline', className: 'underline' },
  { label: 'H2', title: 'Heading', command: 'formatBlock', value: '<h2>' },
  { label: 'P', title: 'Paragraph', command: 'formatBlock', value: '<p>' },
  { label: '• List', title: 'Bullet list', command: 'insertUnorderedList' },
  { label: '1. List', title: 'Numbered list', command: 'insertOrderedList' },
];

/**
 * A small `contentEditable`-based WYSIWYG. No dependency, so no bundle cost —
 * `document.execCommand` is deprecated but every engine this admin targets
 * (Chromium/Firefox/Safari, all evergreen) still implements the handful of
 * commands used here, and pulling in a full editor framework for bold/italic/
 * lists/links would be a lot of weight for what these `html` fields need.
 */
export function RichTextEditor({ value, onChange }) {
  const ref = useRef(null);
  const isFocused = useRef(false);

  useEffect(() => {
    if (!ref.current || isFocused.current) return;
    ref.current.innerHTML = value ?? '';
  }, [value]);

  function exec(command, cmdValue) {
    ref.current?.focus();
    document.execCommand(command, false, cmdValue);
    onChange(ref.current?.innerHTML ?? '');
  }

  function insertLink() {
    const url = window.prompt('Link URL');
    if (!url) return;
    exec('createLink', url);
  }

  return (
    <div className="overflow-hidden rounded border border-gray-300">
      <div className="flex flex-wrap gap-1 border-b border-gray-200 bg-gray-50 p-1">
        {COMMANDS.map((btn) => (
          <button
            key={btn.label}
            type="button"
            title={btn.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(btn.command, btn.value)}
            className={`rounded px-2 py-1 text-xs text-gray-700 hover:bg-gray-200 ${btn.className ?? ''}`}
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          title="Link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={insertLink}
          className="rounded px-2 py-1 text-xs text-gray-700 underline hover:bg-gray-200"
        >
          Link
        </button>
        <button
          type="button"
          title="Remove formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec('removeFormat')}
          className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
        >
          Clear
        </button>
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        onFocus={() => {
          isFocused.current = true;
        }}
        onBlur={() => {
          isFocused.current = false;
        }}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="min-h-[8rem] px-3 py-2 text-sm focus:outline-none [&_h2]:text-lg [&_h2]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-blue-700 [&_a]:underline"
      />
    </div>
  );
}
