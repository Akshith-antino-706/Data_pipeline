'use client';

import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { isTokenAccessPage } from '@/lib/leadsAccess';
import type { ReactNode } from 'react';

// Token-protected pages render without login (the middleware checks their access token).
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();
  const isPublic = isTokenAccessPage(pathname);

  // Middleware handles the redirect server-side. This guard just prevents a flash of
  // dashboard content while hydrating — but PUBLIC paths render even when logged out.
  if (!isAuthenticated && !isPublic) {
    return <div className="spinner">Loading...</div>;
  }

  return children;
}
