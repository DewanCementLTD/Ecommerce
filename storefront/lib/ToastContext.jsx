'use client';

import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);
let nextId = 1;

/**
 * The storefront had no toast component before Phase 2 (grepped for it —
 * zero matches). Small and restrained on purpose: matches the existing
 * .sf-reveal motion language and respects prefers-reduced-motion via the
 * same global rule in globals.css, rather than inventing a new animation.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, { tone = 'default', duration = 3500 } = {}) => {
    const id = nextId++;
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), duration);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* z-40, below the cart drawer's z-50 — a toast must never block a modal's controls. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`sf-reveal pointer-events-auto rounded-pill px-4 py-2 text-sm font-medium shadow-lg ${
              toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-ink text-bg'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
