import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders } from '../../../../lib/server-fetch.js';

export async function GET() {
  const tokens = await readTokens();
  if (!tokens.accessToken) return NextResponse.json({ rows: [] }, { status: 200 });
  const { status, data } = await proxyToApi('/shop/account/addresses', { extraHeaders: authHeaders(tokens) });
  return NextResponse.json(data, { status });
}

export async function POST(request) {
  const body = await request.json();
  const tokens = await readTokens();
  if (!tokens.accessToken) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });
  const { status, data } = await proxyToApi('/shop/account/addresses', {
    method: 'POST',
    body,
    extraHeaders: authHeaders(tokens),
  });
  return NextResponse.json(data, { status });
}
