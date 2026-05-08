'use client';

import { createContext, useContext, useState, useEffect } from 'react';

const BusinessTypeContext = createContext();

export function useBusinessType() {
  return useContext(BusinessTypeContext);
}

export function BusinessTypeProvider({ children }) {
  const [businessType, setBusinessType] = useState('B2C');

  useEffect(() => {
    try {
      const stored = localStorage.getItem('business-type');
      if (stored) setBusinessType(stored);
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('business-type', businessType); } catch {}
  }, [businessType]);

  return (
    <BusinessTypeContext.Provider value={{ businessType, setBusinessType }}>
      {children}
    </BusinessTypeContext.Provider>
  );
}
