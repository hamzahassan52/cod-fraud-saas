'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export type ScanRecord = {
  id: number;
  trackingNumber: string;
  status: 'returned' | 'already_done' | 'not_found';
  customerName?: string;
  externalOrderId?: string;
  riskScore?: number;
  riskLevel?: string;
  time: string;
};

interface ScanHistoryContextType {
  history: ScanRecord[];
  addRecord: (record: ScanRecord) => void;
  totalToday: number;
  returnsToday: number;
}

const ScanHistoryContext = createContext<ScanHistoryContextType>({
  history: [],
  addRecord: () => {},
  totalToday: 0,
  returnsToday: 0,
});

export function ScanHistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<ScanRecord[]>([]);

  const addRecord = useCallback((record: ScanRecord) => {
    setHistory(prev => [record, ...prev].slice(0, 50));
  }, []);

  const totalToday = history.length;
  const returnsToday = history.filter(r => r.status === 'returned').length;

  return (
    <ScanHistoryContext.Provider value={{ history, addRecord, totalToday, returnsToday }}>
      {children}
    </ScanHistoryContext.Provider>
  );
}

export const useScanHistory = () => useContext(ScanHistoryContext);
