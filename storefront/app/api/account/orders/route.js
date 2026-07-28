import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders } from '../../../../lib/server-fetch.js';

export async function GET(request) {
  const tokens = await readTokens();
  if (!tokens.accessToken) return NextResponse.json({ error: { code: 'UNAUTHENTICATED' } }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const qs = searchParams.toString();
  const { status, data } = await proxyToApi(`/shop/account/orders${qs ? `?${qs}` : ''}`, {
    extraHeaders: authHeaders(tokens),
  });
  return NextResponse.json(data, { status });
}
