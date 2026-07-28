import { pageContext } from '../../lib/page-context.js';
import { CheckoutForm } from '../../components/CheckoutForm.jsx';

// Never indexable: a checkout is a private, per-session page.
export const metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

export default async function CheckoutPage() {
  const ctx = await pageContext();
  if (!ctx.company) return null;

  return (
    <div className="sf-container max-w-xl py-8 md:py-12">
      <CheckoutForm hrefBase={ctx.hrefBase} currency={ctx.currency} lang={ctx.lang} />
    </div>
  );
}
