import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { proxyToApi, setCustomerCookies, clearCustomerCookies, REFRESH_COOKIE } from '../../../../lib/server-fetch.js';

export async function POST() {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return NextResponse.json({ error: { code: 'NO_SESSION' } }, { status: 401 });

  const { status, data } = await proxyToApi('/shop/account/refresh', { method: 'POST', body: { refreshToken } });
  if (status >= 400) {
    return clearCustomerCookies(NextResponse.json(data, { status }));
  }
  return setCustomerCookies(NextResponse.json({ ok: true }, { status }), data);
}
