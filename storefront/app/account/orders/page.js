import { pageContext } from '../../../lib/page-context.js';
import { OrderHistory } from '../../../components/OrderHistory.jsx';

export const metadata = {
  title: 'My orders',
  robots: { index: false, follow: false },
};

export default async function AccountOrdersPage() {
  const ctx = await pageContext();
  if (!ctx.company) return null;

  return (
    <div className="sf-container max-w-2xl py-8 md:py-12">
      <OrderHistory hrefBase={ctx.hrefBase} currency={ctx.currency} />
    </div>
  );
}
