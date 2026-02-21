'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from './sidebar';
import { Topbar } from './Topbar';
import { ScanToast, ScanToastData } from '@/components/ui/scan-toast';
import { useGlobalScanner } from '@/hooks/use-global-scanner';
import { useScanHistory } from '@/context/scan-history-context';
import { scannerApi } from '@/lib/api';
import clsx from 'clsx';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [toasts, setToasts] = useState<ScanToastData[]>([]);
  const { addRecord } = useScanHistory();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
    } else {
      setAuthenticated(true);
    }
  }, [router]);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleBarcodeScan = useCallback(async (trackingNumber: string) => {
    const id = Date.now();

    // Show "scanning..." toast immediately
    setToasts(prev => [...prev, {
      id,
      trackingNumber,
      status: 'loading',
    }]);

    try {
      const res = await scannerApi.scan(trackingNumber);
      const data = res.data;
      const status = data.result === 'marked_returned' ? 'returned'
                   : data.result === 'already_processed' ? 'already_done'
                   : 'not_found';

      setToasts(prev => prev.map(t => t.id !== id ? t : {
        id, trackingNumber, status,
        customerName: data.order?.customer_name,
        externalOrderId: data.order?.external_order_id,
        riskScore: data.order?.risk_score,
        riskLevel: data.order?.risk_level,
      }));

      addRecord({
        id, trackingNumber, status,
        customerName: data.order?.customer_name,
        externalOrderId: data.order?.external_order_id,
        riskScore: data.order?.risk_score,
        riskLevel: data.order?.risk_level,
        time: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      });
    } catch {
      setToasts(prev => prev.map(t => t.id !== id ? t : {
        id, trackingNumber, status: 'not_found',
      }));
      addRecord({
        id, trackingNumber, status: 'not_found',
        time: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      });
    }
  }, []);

  useGlobalScanner(handleBarcodeScan);

  if (!authenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-blue-600 dark:border-slate-700 dark:border-t-blue-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
      />
      <div className={clsx(
        'transition-[padding] duration-200 ease-in-out',
        collapsed ? 'lg:pl-[68px]' : 'lg:pl-64'
      )}>
        <Topbar onMenuClick={() => setSidebarOpen(true)} />
        <main className="p-4 sm:p-6">{children}</main>
      </div>

      {/* Global barcode scan toast — appears on any page */}
      <ScanToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
