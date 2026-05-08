'use client';

import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const AuthContext = createContext({
  user: null,
  token: null,
  isAuthenticated: false,
  login: async () => {},
  logout: () => {},
});

const AUTH_KEY = 'rayna-auth';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.token && parsed?.user) {
          setAuth(parsed);
          document.cookie = 'rayna-auth=1; path=/; max-age=604800; SameSite=Lax';
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  const user = auth?.user || null;
  const token = auth?.token || null;
  const isAuthenticated = !!token;

  const login = useCallback(async (email, password) => {
    const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Login failed');
    }

    const authData = { token: data.data.token, user: data.data.user };
    localStorage.setItem(AUTH_KEY, JSON.stringify(authData));
    document.cookie = 'rayna-auth=1; path=/; max-age=604800; SameSite=Lax';
    setAuth(authData);
    return authData.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_KEY);
    document.cookie = 'rayna-auth=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    setAuth(null);
  }, []);

  if (!hydrated) {
    return null;
  }

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
