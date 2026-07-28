import { useAuth } from '../lib/AuthContext.jsx';

/**
 * A persistent reminder that this is not your store (Phase 3, Task 4).
 *
 * When a platform admin uses "view as company", the panel is indistinguishable
 * from a real owner's — same screens, same buttons, same live data. Every
 * action taken here is a real change to a paying client's shop, recorded
 * against the platform account that started the session. That deserves
 * something louder than a note in a log nobody reads until afterwards.
 *
 * Deliberately not dismissible: a banner you can close is a banner that is
 * closed. It stays for the whole ten minutes the token lives.
 */
export function ImpersonationBanner() {
  const { admin, logout } = useAuth();

  if (!admin?.impersonating) return null;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950"
    >
      <span>
        Viewing <strong>{admin.impersonatedCompany ?? 'this store'}</strong> as a platform admin.
        Everything you do here is real and is logged against your account.
      </span>
      <button
        type="button"
        onClick={logout}
        className="rounded bg-amber-950 px-3 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-900"
      >
        Stop viewing
      </button>
    </div>
  );
}
