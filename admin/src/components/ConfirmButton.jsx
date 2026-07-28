import { useState } from 'react';
import { Modal } from './Modal.jsx';

/**
 * Destructive-action button that always confirms first and states exactly what
 * will be deleted (per the admin UX rules in docs/02-PHASE-1-catalog.md Task 7).
 */
export function ConfirmButton({ label, confirmTitle, confirmMessage, onConfirm, className, disabled }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={
          className ??
          'rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500'
        }
      >
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={confirmTitle ?? 'Are you sure?'}>
        <p className="text-sm text-gray-600">{confirmMessage}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </>
  );
}
