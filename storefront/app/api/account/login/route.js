import { NextResponse } from 'next/server';
import { proxyToApi, setCustomerCookies } from '../../../../lib/server-fetch.js';

export async function POST(request) {
  const body = await request.json();
  const { status, data } = await proxyToApi('/shop/account/login', { method: 'POST', body });
  if (status >= 400) return NextResponse.json(data, { status });

  const response = NextResponse.json({ customer: data.customer }, { status });
  return setCustomerCookies(response, data);
}
