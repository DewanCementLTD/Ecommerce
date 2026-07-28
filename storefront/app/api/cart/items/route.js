import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders, setCartCookie } from '../../../../lib/server-fetch.js';

export async function POST(request) {
  const body = await request.json();
  const tokens = await readTokens();
  const { status, data } = await proxyToApi('/shop/cart/items', {
    method: 'POST',
    body,
    extraHeaders: authHeaders(tokens),
  });
  return setCartCookie(NextResponse.json(data, { status }), data);
}
