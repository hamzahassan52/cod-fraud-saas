'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

interface Store {
  id: string;
  name: string;
  platform: string;
  domain?: string;
}

interface StoreContextType {
  stores: Store[];
  selectedStore: Store | null;
  switchStore: (storeId: string) => void;
  isLoading: boolean;
}

const StoreContext = createContext<StoreContextType>({
  stores: [],
  selectedStore: null,
  switchStore: () => {},
  isLoading: false,
});

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load stores from localStorage or API
    const tenant = localStorage.getItem('tenant');
    if (tenant) {
      try {
        const parsed = JSON.parse(tenant);
        const defaultStore: Store = {
          id: parsed.id || '1',
          name: parsed.companyName || 'My Store',
          platform: 'shopify',
          domain: parsed.domain,
        };
        setStores([defaultStore]);
        setSelectedStore(defaultStore);
      } catch {
        // Fallback
        const fallback: Store = { id: '1', name: 'My Store', platform: 'shopify' };
        setStores([fallback]);
        setSelectedStore(fallback);
      }
    }
    setIsLoading(false);
  }, []);

  const switchStore = (storeId: string) => {
    const store = stores.find((s) => s.id === storeId);
    if (store) {
      setSelectedStore(store);
      localStorage.setItem('selectedStoreId', storeId);
    }
  };

  return (
    <StoreContext.Provider value={{ stores, selectedStore, switchStore, isLoading }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}
