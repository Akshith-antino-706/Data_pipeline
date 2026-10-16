'use client';

import { createContext, useContext, useState, useEffect, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { SCOPES } from '@/lib/contactTypes';
import type { Scope } from '@/types/api';

export interface BusinessTypeContextValue {
  businessType: Scope;
  setBusinessType: Dispatch<SetStateAction<Scope>>;
}

// undefined outside a provider, exactly like the old createContext() with no default.
const BusinessTypeContext = createContext<BusinessTypeContextValue | undefined>(undefined);

export function useBusinessType(): BusinessTypeContextValue {
  // Every caller sits under <BusinessTypeProvider> (app/providers), so the value is always set.
  return useContext(BusinessTypeContext) as BusinessTypeContextValue;
}

const isScope = (v: string | null): v is Scope => v !== null && (SCOPES as string[]).includes(v);

export function BusinessTypeProvider({ children }: { children: ReactNode }) {
  const [businessType, setBusinessType] = useState<Scope>('B2C');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('business-type');
      if (isScope(stored)) setBusinessType(stored);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem('business-type', businessType); } catch { /* ignore */ }
  }, [businessType]);

  return (
    <BusinessTypeContext.Provider value={{ businessType, setBusinessType }}>
      {children}
    </BusinessTypeContext.Provider>
  );
}
