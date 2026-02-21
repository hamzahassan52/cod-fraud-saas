'use client';

import { useEffect } from 'react';
import clsx from 'clsx';

export type ScanToastData = {
  id: number;
  trackingNumber: string;
  status: 'loading' | 'returned' | 'already_done' | 'not_found';
  customerName?: string;
  externalOrderId?: string;
  riskScore?: number;
  riskLevel?: string;
};

interface ScanToastProps {
  toasts: ScanToastData[];
  onDismiss: (id: number) => void;
}

export function ScanToast({ toasts, onDismiss }: ScanToastProps) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: ScanToastData; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.status === 'loading') return;
    const t = setTimeout(() => onDismiss(toast.id), 2500);
    return () => clearTimeout(t);
  }, [toast.status, toast.id, onDismiss]);

  const colors = {
    loading:    'bg-gray-800 border-gray-600 text-gray-200',
    returned:   'bg-red-900/95 border-red-500 text-white',
    already_done: 'bg-yellow-900/95 border-yellow-500 text-white',
    not_found:  'bg-gray-800/95 border-gray-600 text-gray-300',
  };

  const icons = {
    loading:    <span className="animate-spin rounded-full h-5 w-5 border-2 border-gray-400 border-t-white inline-block" />,
    returned:   <span className="text-xl">📦</span>,
    already_done: <span className="text-xl">⚠️</span>,
    not_found:  <span className="text-xl">❌</span>,
  };

  const titles = {
    loading:    'Scanning...',
    returned:   'Return Recorded',
    already_done: 'Already Processed',
    not_found:  'Not Found',
  };

  return (
    <div className={clsx(
      'pointer-events-auto w-80 rounded-xl border shadow-2xl p-4',
      'animate-in slide-in-from-right-4 fade-in duration-200',
      colors[toast.status]
    )}>
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icons[toast.status]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-sm">{titles[toast.status]}</p>
            {toast.status !== 'loading' && (
              <button
                onClick={() => onDismiss(toast.id)}
                className="text-white/50 hover:text-white/80 flex-shrink-0 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <p className="font-mono text-xs mt-0.5 opacity-70">{toast.trackingNumber}</p>

          {toast.status === 'returned' && toast.customerName && (
            <div className="mt-2 space-y-0.5">
              <p className="text-sm font-medium">{toast.customerName}</p>
              {toast.externalOrderId && (
                <p className="text-xs opacity-70">Order #{toast.externalOrderId}</p>
              )}
              {toast.riskScore !== undefined && (
                <p className={clsx(
                  'text-xs font-semibold',
                  toast.riskLevel === 'HIGH' || toast.riskLevel === 'CRITICAL' ? 'text-red-300' :
                  toast.riskLevel === 'MEDIUM' ? 'text-yellow-300' : 'text-green-300'
                )}>
                  Risk: {toast.riskScore}/100 · {toast.riskLevel}
                </p>
              )}
            </div>
          )}

          {toast.status === 'already_done' && (
            <p className="text-xs mt-1 opacity-70">This parcel was already scanned.</p>
          )}
          {toast.status === 'not_found' && (
            <p className="text-xs mt-1 opacity-70">No order with this tracking number.</p>
          )}
        </div>
      </div>
    </div>
  );
}
