import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders } from '../../../../lib/server-fetch.js';

export async function GET() {
  const tokens = await readTokens();
  if (!tokens.accessToken) return NextResponse.json({ customer: null }, { status: 200 });
  const { status, data } = await proxyToApi('/shop/account/me', { extraHeaders: authHeaders(tokens) });
  if (status === 401) return NextResponse.json({ customer: null }, { status: 200 });
  return NextResponse.json(data, { status });
}

export async function PATCH(request) {
  const body = await request.json();
  const tokens = await readTokens();
  const { status, data } = await proxyToApi('/shop/account/me', {
    method: 'PATCH',
    body,
    extraHeaders: authHeaders(tokens),
  });
  return NextResponse.json(data, { status });
}
