import { pageContext } from '../../lib/page-context.js';
import { AccountPanel } from '../../components/AccountPanel.jsx';

// Never indexable: everything behind it belongs to one customer.
export const metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const ctx = await pageContext();
  if (!ctx.company) return null;

  return (
    <div className="sf-container max-w-md py-8 md:py-12">
      <AccountPanel hrefBase={ctx.hrefBase} />
    </div>
  );
}
