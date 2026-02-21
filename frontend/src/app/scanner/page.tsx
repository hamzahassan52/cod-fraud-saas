'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { useScanHistory } from '@/context/scan-history-context';
import { mlApi } from '@/lib/api';
import clsx from 'clsx';

interface TrainingStats {
  total: number;
  unused: number;
  label0: number;
  label1: number;
  threshold: number;
  readyToRetrain: boolean;
}

export default function ScannerPage() {
  const { history, totalToday, returnsToday } = useScanHistory();
  const [stats, setStats] = useState<TrainingStats | null>(null);

  useEffect(() => {
    mlApi.trainingStats()
      .then(res => setStats(res.data))
      .catch(() => {});
  }, []);

  const statusLabel = (s: string) => {
    if (s === 'returned') return { text: 'Return Recorded', color: 'text-red-500 dark:text-red-400' };
    if (s === 'already_done') return { text: 'Already Done', color: 'text-yellow-500 dark:text-yellow-400' };
    return { text: 'Not Found', color: 'text-gray-400' };
  };

  const statusDot = (s: string) => {
    if (s === 'returned') return 'bg-red-500';
    if (s === 'already_done') return 'bg-yellow-500';
    return 'bg-gray-400';
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Return Scanner</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Physical barcode scanner se automatic returns record ho rahe hain
            </p>
          </div>
          <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 rounded-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-green-700 dark:text-green-400">Scanner Active</span>
          </div>
        </div>

        {/* Today's stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{totalToday}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Scanned Today</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-red-600 dark:text-red-400">{returnsToday}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Returns Today</p>
          </div>
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-4 text-center">
            <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{stats?.total ?? '—'}</p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">All-time Returns</p>
          </div>
          <div className={clsx(
            'rounded-xl p-4 text-center border',
            stats?.readyToRetrain
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-white dark:bg-slate-800 border-gray-200 dark:border-slate-700'
          )}>
            <p className={clsx(
              'text-3xl font-bold',
              stats?.readyToRetrain ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-slate-100'
            )}>
              {stats ? `${stats.unused}/${stats.threshold}` : '—'}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">ML Progress</p>
          </div>
        </div>

        {/* How it works */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-2">Scanner Workflow</p>
          <p className="text-sm text-blue-700 dark:text-blue-400">
            USB/Bluetooth barcode scanner connect karo → koi bhi dashboard page kholo → returned parcel ka barcode scan karo → <strong>automatic update</strong>: DB mein return record, order status RTO, ML training data save.
            Koi button click nahi, koi tracking number type nahi.
          </p>
        </div>

        {/* Scan History */}
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-slate-700 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Today's Scan History</h2>
            <span className="text-xs text-gray-400">{history.length} scans</span>
          </div>

          {history.length === 0 ? (
            <div className="py-16 text-center">
              <svg className="w-12 h-12 text-gray-300 dark:text-slate-600 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              </svg>
              <p className="text-sm text-gray-400 dark:text-slate-500">Koi scan nahi hua — barcode scan karo</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-slate-700/50">
              {history.map((item) => {
                const label = statusLabel(item.status);
                return (
                  <div key={item.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={clsx('w-2.5 h-2.5 rounded-full flex-shrink-0', statusDot(item.status))} />
                      <div className="min-w-0">
                        <p className="font-mono text-sm font-medium text-gray-900 dark:text-slate-100 truncate">
                          {item.trackingNumber}
                        </p>
                        {item.customerName && (
                          <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                            {item.customerName}
                            {item.externalOrderId && ` · #${item.externalOrderId}`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 flex-shrink-0 ml-3">
                      {item.riskScore !== undefined && (
                        <span className={clsx(
                          'text-xs font-semibold hidden sm:block',
                          item.riskLevel === 'HIGH' || item.riskLevel === 'CRITICAL' ? 'text-red-500' :
                          item.riskLevel === 'MEDIUM' ? 'text-yellow-500' : 'text-green-500'
                        )}>
                          {item.riskScore}/100
                        </span>
                      )}
                      <span className={clsx('text-xs font-medium', label.color)}>{label.text}</span>
                      <span className="text-xs text-gray-400 dark:text-slate-500 w-12 text-right">{item.time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}
