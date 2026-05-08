'use client';

import { useAuth } from '@/context/AuthContext';

export function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();

  // Middleware handles the redirect server-side.
  // This guard just prevents a flash of dashboard content while hydrating.
  if (!isAuthenticated) {
    return <div className="spinner">Loading...</div>;
  }

  return children;
}
