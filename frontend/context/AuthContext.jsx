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
const LAST_ACTIVITY_KEY = 'rayna-last-activity';
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // auto-logout after 30 min of inactivity

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
    } catch { /* ignore malformed storage */ }
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

    const authData = { token: data.data.token, refreshToken: data.data.refreshToken, user: data.data.user };
    localStorage.setItem(AUTH_KEY, JSON.stringify(authData));
    document.cookie = 'rayna-auth=1; path=/; max-age=604800; SameSite=Lax';
    setAuth(authData);
    return authData.user;
  }, []);

  const logout = useCallback(() => {
    const BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    // Read the refresh token straight from storage (state may be stale) and revoke it
    // server-side. keepalive lets the request finish even though we navigate away below.
    let refreshToken = null;
    try { refreshToken = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null')?.refreshToken || null; } catch { /* ignore */ }
    if (refreshToken) {
      fetch(`${BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        keepalive: true,
      }).catch(() => {});
    }

    // Wipe ALL client-side state: localStorage, sessionStorage, and cookies.
    try { localStorage.clear(); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
    try {
      document.cookie.split(';').forEach((c) => {
        const name = c.split('=')[0].trim();
        if (name) document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      });
    } catch { /* ignore */ }

    setAuth(null);
    // Hard-navigate to the login screen (replace so the authed page isn't left in history).
    if (typeof window !== 'undefined') window.location.replace('/login');
  }, []);

  // Auto-logout after 30 minutes of inactivity. Any user interaction resets the timer;
  // returning to a tab that has been idle past the limit logs out immediately. lastActivity
  // is persisted so a refresh can't be used to bypass the idle window.
  useEffect(() => {
    if (!isAuthenticated) return;
    let timer;

    const reset = () => {
      try { localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ }
      clearTimeout(timer);
      timer = setTimeout(logout, INACTIVITY_LIMIT_MS);
    };

    // Throttle high-frequency events (mousemove/scroll) to at most once per second.
    let lastHit = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastHit < 1000) return;
      lastHit = now;
      reset();
    };

    const idleFor = () => {
      let ts = 0;
      try { ts = parseInt(localStorage.getItem(LAST_ACTIVITY_KEY) || '0', 10); } catch { /* ignore */ }
      return ts ? Date.now() - ts : 0;
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (idleFor() >= INACTIVITY_LIMIT_MS) logout();
      else reset();
    };

    // On mount: if already idle beyond the limit (e.g. refreshed after walking away), log out.
    if (idleFor() >= INACTIVITY_LIMIT_MS) { logout(); return; }

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisible);
    reset();

    return () => {
      clearTimeout(timer);
      events.forEach(e => window.removeEventListener(e, onActivity));
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, logout]);

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
