import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders, setCartCookie } from '../../../../../lib/server-fetch.js';

export async function PATCH(request, { params }) {
  const { id } = await params;
  const body = await request.json();
  const tokens = await readTokens();
  const { status, data } = await proxyToApi(`/shop/cart/items/${id}`, {
    method: 'PATCH',
    body,
    extraHeaders: authHeaders(tokens),
  });
  return setCartCookie(NextResponse.json(data, { status }), data);
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const tokens = await readTokens();
  const { status, data } = await proxyToApi(`/shop/cart/items/${id}`, {
    method: 'DELETE',
    extraHeaders: authHeaders(tokens),
  });
  return setCartCookie(NextResponse.json(data, { status }), data);
}
