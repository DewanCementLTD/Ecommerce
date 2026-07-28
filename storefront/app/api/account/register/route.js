import { NextResponse } from 'next/server';
import { proxyToApi, setCustomerCookies } from '../../../../lib/server-fetch.js';

export async function POST(request) {
  const body = await request.json();
  const { status, data } = await proxyToApi('/shop/account/register', { method: 'POST', body });
  if (status >= 400) return NextResponse.json(data, { status });

  // Tokens stay server-side, in httpOnly cookies — the browser only ever sees the customer record.
  const response = NextResponse.json({ customer: data.customer }, { status });
  return setCustomerCookies(response, data);
}
