import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

const navLinkClass = ({ isActive }) =>
  `rounded px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
    isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`;

export function Layout() {
  const { admin, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <nav className="flex flex-wrap gap-1" aria-label="Main navigation">
            <NavLink to="/companies" className={navLinkClass} end>
              Companies
            </NavLink>
            <NavLink to="/companies/new" className={navLinkClass}>
              New company
            </NavLink>
            <NavLink to="/logs" className={navLinkClass}>
              Audit log
            </NavLink>
          </nav>
          <div className="flex items-center gap-3 text-sm text-gray-600">
            {admin && <span>{admin.email}</span>}
            <button
              type="button"
              onClick={logout}
              className="rounded px-3 py-2 font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
