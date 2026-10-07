import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UCOrder } from '@/hooks/useApi';
import { useAuth } from '@/context/AuthContext';

/** Last successful confirmation only; never stored on disk or in a URL. */
const Context = createContext<{
  order: UCOrder | null;
  retainOrder: (order: UCOrder) => void;
}>({ order: null, retainOrder: () => {} });

export function CheckoutReceiptProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [snapshot, setSnapshot] = useState<{ token: string | null; order: UCOrder } | null>(null);
  useEffect(() => {
    setSnapshot((current) => current?.token === token ? current : null);
  }, [token]);
  return (
    <Context.Provider value={{
      order: snapshot?.token === token ? snapshot.order : null,
      retainOrder: (order) => setSnapshot({ token, order }),
    }}>
      {children}
    </Context.Provider>
  );
}

export const useCheckoutReceipt = () => useContext(Context);
