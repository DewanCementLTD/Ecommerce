import { headers } from 'next/headers';

export default async function robots() {
  const headersList = await headers();
  const host = headersList.get('x-forwarded-host') || headersList.get('host') || '';
  const proto = headersList.get('x-forwarded-proto') || 'http';

  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${proto}://${host}/sitemap.xml`,
  };
}
