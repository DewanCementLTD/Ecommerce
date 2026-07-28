import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';

const NAV_SECTIONS = [
  {
    label: 'Catalog',
    items: [
      { to: '/products', label: 'Products' },
      { to: '/categories', label: 'Categories' },
      { to: '/collections', label: 'Collections' },
      { to: '/media', label: 'Media' },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/pages', label: 'Pages' },
      { to: '/banners', label: 'Banners' },
      { to: '/menus', label: 'Menus' },
      { to: '/translations', label: 'Translations' },
    ],
  },
  {
    label: 'Sales',
    items: [
      { to: '/orders', label: 'Orders' },
      { to: '/customers', label: 'Customers' },
    ],
  },
  {
    label: 'Store',
    items: [
      { to: '/settings', label: 'Settings' },
      { to: '/staff', label: 'Staff' },
    ],
  },
];

const navLinkClass = ({ isActive }) =>
  `block rounded px-3 py-2 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
    isActive ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
  }`;

export function Layout() {
  const { admin, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 lg:hidden">
        <span className="text-lg font-semibold text-gray-900">Storeforge</span>
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-expanded={navOpen}
          aria-controls="admin-sidebar"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          Menu
        </button>
      </header>

      <aside
        id="admin-sidebar"
        className={`w-full flex-shrink-0 border-b border-gray-200 bg-white lg:block lg:w-64 lg:border-b-0 lg:border-r ${
          navOpen ? 'block' : 'hidden'
        }`}
      >
        <div className="flex h-full flex-col px-3 py-4">
          <div className="hidden px-2 pb-4 text-lg font-semibold text-gray-900 lg:block">Storeforge</div>
          <nav className="flex-1 space-y-4" aria-label="Main navigation">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <p className="px-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {section.label}
                </p>
                <div className="mt-1 space-y-0.5">
                  {section.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={navLinkClass}
                      onClick={() => setNavOpen(false)}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
          <div className="mt-4 space-y-1 border-t border-gray-200 pt-4 text-sm text-gray-600">
            {admin && <p className="truncate px-3">{admin.email}</p>}
            <button
              type="button"
              onClick={logout}
              className="w-full rounded px-3 py-2 text-left font-medium text-gray-700 hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              Log out
            </button>
          </div>
        </div>
      </aside>

      <main id="main-content" className="min-w-0 flex-1 px-4 py-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
