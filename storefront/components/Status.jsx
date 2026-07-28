/**
 * The three pages that are not a store: unknown domain, suspended store, and
 * 404. All three are complete, styled pages — a visitor who lands on one should
 * see something considered, not a stack trace or a blank screen.
 */

function Shell({ title, body, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-20">
      <div className="max-w-prose text-center">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-4 text-muted">{body}</p>
        {children ? <div className="mt-8">{children}</div> : null}
      </div>
    </div>
  );
}

export function StoreNotFound() {
  return (
    <Shell
      title="No store lives here yet"
      body="This address is not connected to a store. If you were given this link by a shop, check it for a typo."
    />
  );
}

export function StoreUnavailable() {
  return (
    <Shell
      title="Back shortly"
      body="This store is temporarily unavailable. Nothing is wrong with your connection — please try again a little later."
    />
  );
}
