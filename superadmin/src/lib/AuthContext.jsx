import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

const STORAGE_KEY = 'sf_superadmin_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEY));
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.me(token);
        if (!cancelled) setAdmin(res.admin);
      } catch {
        if (!cancelled) {
          setToken(null);
          localStorage.removeItem(STORAGE_KEY);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const login = useCallback(async (email, password) => {
    const res = await api.login(email, password);
    if (res.admin.role !== 'platform') {
      throw new Error('Only platform accounts can use the Super Admin panel.');
    }
    localStorage.setItem(STORAGE_KEY, res.accessToken);
    setToken(res.accessToken);
    setAdmin(res.admin);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setAdmin(null);
  }, []);

  const value = useMemo(() => ({ token, admin, loading, login, logout }), [token, admin, loading, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
