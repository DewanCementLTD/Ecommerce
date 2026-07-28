'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

const AccountContext = createContext(null);

async function callApi(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? 'Something went wrong.');
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

/** Optional customer accounts — guest checkout never depends on this being populated. */
export function AccountProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await callApi('/api/account/me');
    setCustomer(data.customer);
    return data.customer;
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const register = useCallback(async (fields) => {
    const data = await callApi('/api/account/register', { method: 'POST', body: fields });
    setCustomer(data.customer);
    return data.customer;
  }, []);

  const login = useCallback(async (email, password) => {
    const data = await callApi('/api/account/login', { method: 'POST', body: { email, password } });
    setCustomer(data.customer);
    return data.customer;
  }, []);

  const logout = useCallback(async () => {
    await callApi('/api/account/logout', { method: 'POST' });
    setCustomer(null);
  }, []);

  const updateProfile = useCallback(async (fields) => {
    const data = await callApi('/api/account/me', { method: 'PATCH', body: fields });
    setCustomer(data.customer);
    return data.customer;
  }, []);

  return (
    <AccountContext.Provider value={{ customer, loading, register, login, logout, updateProfile, refresh }}>
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error('useAccount must be used within AccountProvider');
  return ctx;
}
