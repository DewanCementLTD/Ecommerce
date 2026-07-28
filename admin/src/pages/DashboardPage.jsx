import { useAuth } from '../lib/AuthContext.jsx';

export function DashboardPage() {
  const { admin } = useAuth();
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold text-gray-900">Welcome{admin?.name ? `, ${admin.name}` : ''}</h1>
      <p className="text-gray-500">
        Orders and sales summary land here once Phase 2 ships. Use the menu to manage your catalog and
        storefront content in the meantime.
      </p>
    </div>
  );
}
