import { NextResponse } from 'next/server';
import { proxyToApi, readTokens, authHeaders } from '../../../lib/server-fetch.js';

export async function POST(request) {
  const body = await request.json();
  const tokens = await readTokens();
  const idempotencyKey = request.headers.get('idempotency-key');

  const { status, data } = await proxyToApi('/shop/checkout', {
    method: 'POST',
    body,
    extraHeaders: {
      ...authHeaders(tokens),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
  });
  return NextResponse.json(data, { status });
}
