import { Button } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="sf-container flex min-h-[60vh] items-center justify-center py-20">
      <div className="max-w-prose text-center">
        <p className="font-display text-6xl font-extrabold text-accent">404</p>
        <h1 className="mt-4">We could not find that page</h1>
        <p className="mt-3 text-muted">
          The link may be out of date, or the product may no longer be for sale.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Button href="/">Back to the shop</Button>
        </div>
      </div>
    </div>
  );
}
