'use client';

import { useCart } from '../lib/CartContext.jsx';

export function CartButton({ label }) {
  const { count, setDrawerOpen } = useCart();

  return (
    <button
      type="button"
      onClick={() => setDrawerOpen(true)}
      aria-label={count > 0 ? `${label} (${count} item${count === 1 ? '' : 's'})` : label}
      className="relative rounded-pill p-2 text-ink/70 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="10" cy="20" r="1.4" />
        <circle cx="17" cy="20" r="1.4" />
      </svg>
      {count > 0 && (
        <span className="absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-white">
          {count}
        </span>
      )}
    </button>
  );
}
