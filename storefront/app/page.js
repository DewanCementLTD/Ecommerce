import { headers } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

async function getCompany() {
  const headersList = await headers();
  const host = headersList.get('host');

  const res = await fetch(`${API_URL}/storefront/company`, {
    headers: { 'X-Forwarded-Host': host ?? '' },
    cache: 'no-store',
  });

  if (res.status === 503) return { suspended: true };
  if (!res.ok) return null;

  const data = await res.json();
  return { company: data.company };
}

export default async function HomePage() {
  const result = await getCompany();

  if (!result) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Store not found</h1>
          <p className="mt-2 text-gray-500">This domain isn&apos;t connected to any Storeforge store.</p>
        </div>
      </main>
    );
  }

  if (result.suspended) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Temporarily unavailable</h1>
          <p className="mt-2 text-gray-500">This store is currently suspended.</p>
        </div>
      </main>
    );
  }

  const { company } = result;
  const theme = company.theme ?? {};
  const primaryColor = theme.primaryColor ?? '#111827';
  const secondaryColor = theme.secondaryColor ?? '#6b7280';
  const backgroundColor = theme.backgroundColor ?? '#ffffff';
  const textColor = theme.textColor ?? '#111827';
  const logoUrl = company.logoUrl ? `${API_URL}${company.logoUrl}` : null;

  return (
    <main style={{ backgroundColor, color: textColor, minHeight: '100vh' }} className="flex flex-col">
      <header
        style={{ borderBottom: `4px solid ${primaryColor}` }}
        className="flex items-center gap-3 px-4 py-4 sm:px-6"
      >
        {logoUrl ? (
          <img src={logoUrl} alt={`${company.name} logo`} className="h-10 w-10 rounded object-cover" />
        ) : (
          <div
            style={{ backgroundColor: primaryColor }}
            className="flex h-10 w-10 items-center justify-center rounded text-lg font-bold text-white"
            aria-hidden="true"
          >
            {company.name.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-lg font-semibold">{company.name}</span>
      </header>

      <section className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-16 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Welcome to {company.name}</h1>
        <p style={{ color: secondaryColor }} className="max-w-md text-base">
          This storefront is served entirely from Storeforge&apos;s shared codebase — theme, name, and logo
          all come from the database, resolved by the domain you&apos;re visiting on.
        </p>
      </section>

      <footer className="px-4 py-6 text-center text-sm" style={{ color: secondaryColor }}>
        &copy; {new Date().getFullYear()} {company.name}
      </footer>
    </main>
  );
}
