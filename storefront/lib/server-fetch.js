import { headers, cookies } from 'next/headers';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export const CART_COOKIE = 'cart_token';
export const ACCESS_COOKIE = 'customer_access_token';
export const REFRESH_COOKIE = 'customer_refresh_token';
const CART_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matching carts.expires_at
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, matching JWT_REFRESH_TTL

const cookieOpts = { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' };

/**
 * The one place the storefront talks to Express for anything beyond a plain
 * SSR read. Every mutation (cart, checkout, account) goes through a route
 * handler that calls this, because only the Next layer can see the incoming
 * request's real Host — the same header apiGet forwards for reads — and
 * because Express itself owns no cookies at all (see docs/DECISIONS.md):
 * the cart token and the customer's JWTs are httpOnly cookies this layer
 * sets, never something the API manages.
 */
export async function proxyToApi(path, { method = 'GET', body, extraHeaders = {} } = {}) {
  const headersList = await headers();
  const host = headersList.get('host') || '';
  const res = await fetch(new URL(path, API_URL), {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-Host': host, ...extraHeaders },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** The two tokens every cart/checkout/account route handler needs from the browser. */
export async function readTokens() {
  const store = await cookies();
  return {
    cartToken: store.get(CART_COOKIE)?.value,
    accessToken: store.get(ACCESS_COOKIE)?.value,
  };
}

export function authHeaders({ cartToken, accessToken }) {
  return {
    ...(cartToken ? { 'X-Cart-Token': cartToken } : {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

/** Cart responses always carry `token` — the response cookie is refreshed every time. */
export async function setCartCookie(response, data) {
  if (data?.token) {
    response.cookies.set(CART_COOKIE, data.token, { ...cookieOpts, maxAge: CART_MAX_AGE });
  }
  return response;
}

export async function setCustomerCookies(response, { accessToken, refreshToken }) {
  if (accessToken) {
    // No maxAge: an access-token cookie should not outlive the browser
    // session by default; refresh handles renewing it.
    response.cookies.set(ACCESS_COOKIE, accessToken, cookieOpts);
  }
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, { ...cookieOpts, maxAge: REFRESH_MAX_AGE });
  }
  return response;
}

export async function clearCustomerCookies(response) {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
