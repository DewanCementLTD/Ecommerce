import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders, setCartCookie } from '../../../lib/server-fetch.js';

export async function GET() {
  const tokens = await readTokens();
  const { status, data } = await proxyToApi('/shop/cart', { extraHeaders: authHeaders(tokens) });
  return setCartCookie(NextResponse.json(data, { status }), data);
}

export async function DELETE() {
  const tokens = await readTokens();
  const { status, data } = await proxyToApi('/shop/cart', { method: 'DELETE', extraHeaders: authHeaders(tokens) });
  return setCartCookie(NextResponse.json(data, { status }), data);
}
