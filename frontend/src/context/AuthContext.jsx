import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext();

const AUTH_KEY = 'rayna-auth';

function getStoredAuth() {
  try {
    const stored = localStorage.getItem(AUTH_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed?.token || !parsed?.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState(getStoredAuth);

  const user = auth?.user || null;
  const token = auth?.token || null;
  const isAuthenticated = !!token;

  const login = useCallback(async (email, password) => {
    const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
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
    setAuth(authData);
    return authData.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_KEY);
    setAuth(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isAuthenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
