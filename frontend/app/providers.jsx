'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/context/ThemeContext';
import { BusinessTypeProvider } from '@/context/BusinessTypeContext';
import { AuthProvider } from '@/context/AuthContext';
import { Toaster } from 'react-hot-toast';

export function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BusinessTypeProvider>
          <AuthProvider>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                duration: 4000,
                style: { background: '#111', color: '#fff', fontSize: 13, borderRadius: 10, padding: '10px 16px' },
                error: { style: { background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }, iconTheme: { primary: '#dc2626', secondary: '#fff' } },
                success: { style: { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }, iconTheme: { primary: '#16a34a', secondary: '#fff' } },
              }}
            />
          </AuthProvider>
        </BusinessTypeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
