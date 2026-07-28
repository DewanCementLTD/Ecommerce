import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders, clearCustomerCookies } from '../../../../lib/server-fetch.js';

export async function POST() {
  const tokens = await readTokens();
  if (tokens.accessToken) {
    await proxyToApi('/shop/account/logout', { method: 'POST', extraHeaders: authHeaders(tokens) });
  }
  return clearCustomerCookies(new NextResponse(null, { status: 204 }));
}
