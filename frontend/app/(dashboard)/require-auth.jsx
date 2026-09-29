'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

// Paths that render without login (kept in sync with middleware.js PUBLIC_PATHS).
const PUBLIC_PATHS = ['/leads'];

export function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // Middleware handles the redirect server-side. This guard just prevents a flash of
  // dashboard content while hydrating — but PUBLIC paths render even when logged out.
  if (!isAuthenticated && !isPublic) {
    return <div className="spinner">Loading...</div>;
  }

  return children;
}
