'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { useScanHistory } from '@/context/scan-history-context';
import { scannerApi, mlApi } from '@/lib/api';
import { beepSuccess, beepError, beepWarning } from '@/lib/scanner-beep';
import clsx from 'clsx';

interface TrainingStats {
  total: number;
  unused: number;
  label0: number;
  label1: number;
  threshold: number;
  readyToRetrain: boolean;
}

type ManualResult = {
  status: 'returned' | 'already_done' | 'not_found';
  message: string;
  customerName?: string;
  externalOrderId?: string;
  riskScore?: number;
  riskLevel?: string;
} | null;

export default function ScannerPage() {
  const { history, totalToday, returnsToday, addRecord } = useScanHistory();
  const [stats, setStats] = useState<TrainingStats | null>(null);

  // Manual fallback
  const [showManual, setShowManual] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<ManualResult>(null);
  const manualInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    mlApi.trainingStats().then(res => setStats(res.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (showManual) setTimeout(() => manualInputRef.current?.focus(), 50);
  }, [showManual]);

  const handleManualScan = useCallback(async () => {
    const value = manualValue.trim().toUpperCase();
    if (!value) return;
    setManualLoading(true);
    setManualResult(null);
    try {
      const res = await scannerApi.scan(value);
      const data = res.data;
      const status = data.result === 'marked_returned' ? 'returned'
                   : data.result === 'already_processed' ? 'already_done'
                   : 'not_found';

      if (status === 'returned') beepSuccess();
      else if (status === 'already_done') beepWarning();
      else beepError();

      setManualResult({
        status,
        message: data.message,
        customerName: data.order?.customer_name,
        externalOrderId: data.order?.external_order_id,
        riskScore: data.order?.risk_score,
        riskLevel: data.order?.risk_level,
      });

      const id = Date.now();
      addRecord({
        id, trackingNumber: value, status,
        customerName: data.order?.customer_name,
        externalOrderId: data.order?.external_order_id,
        riskScore: data.order?.risk_score,
        riskLevel: data.order?.risk_level,
        time: new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }),
      });

      setManualValue('');
    } catch (err: any) {
      beepError();
      setManualResult({ status: 'not_found', message: err.response?.data?.message || 'Order not found' });
      setManualValue('');
    } finally {
      setManualLoading(false);
    }
  }, [manualValue, addRecord]);

  const statusLabel = (s: string) => {
    if (s === 'returned') return { text: 'Return Recorded', color: 'text-red-500 dark:text-red-400' };
    if (s === 'already_done') return { text: 'Already Done', color: 'text-yellow-500 dark:text-yellow-400' };
    return { text: 'Not Found', color: 'text-gray-400' };
  };

  const statusDot = (s: string) => {
    if (s === 'returned') return 'bg-red-500';
    if (s === 'already_done') return 'bg-yellow-400';
    return 'bg-gray-400';
  };

  const manualResultColors = {
    returned:    'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700',
    already_done:'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-300 dark:border-yellow-700',
    not_found:   'bg-gray-50 dark:bg-slate-700/50 border-gray-200 dark:border-slate-600',
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Return Scanner</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Physical barcode scanner se automatic returns record ho rahe hain
            </p>
          </div>
          <div className="flex items-center gap-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 rounded-lg flex-shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-green-700 dark:text-green-400">Scanner Active</span>
          </div>
        </div>

        {/* Stats */}
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
            <p className={clsx('text-3xl font-bold', stats?.readyToRetrain ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-slate-100')}>
              {stats ? `${stats.unused}/${stats.threshold}` : '—'}
            </p>
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">ML Progress</p>
          </div>
        </div>

        {/* Manual Fallback */}
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
          <button
            onClick={() => { setShowManual(v => !v); setManualResult(null); }}
            className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <div className="text-left">
                <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                  Barcode damaged? Manual Entry
                </p>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                  Agar scanner barcode read na kar sake — tracking number type karo
                </p>
              </div>
            </div>
            <svg className={clsx('w-4 h-4 text-gray-400 transition-transform', showManual && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </button>

          {showManual && (
            <div className="px-5 pb-5 border-t border-gray-100 dark:border-slate-700 pt-4 space-y-3">
              <div className="flex gap-2">
                <input
                  ref={manualInputRef}
                  type="text"
                  value={manualValue}
                  onChange={e => setManualValue(e.target.value.toUpperCase())}
                  onKeyDown={e => e.key === 'Enter' && handleManualScan()}
                  placeholder="TRK-XXXXXX"
                  disabled={manualLoading}
                  className="flex-1 bg-gray-50 dark:bg-slate-900 border border-gray-300 dark:border-slate-600
                             rounded-lg px-4 py-2.5 text-sm font-mono text-gray-900 dark:text-slate-100
                             placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={handleManualScan}
                  disabled={manualLoading || !manualValue.trim()}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-40
                             disabled:cursor-not-allowed text-white text-sm font-semibold
                             rounded-lg transition-colors"
                >
                  {manualLoading ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                      Processing
                    </span>
                  ) : 'Submit'}
                </button>
              </div>

              {manualResult && (
                <div className={clsx('border rounded-lg p-3 text-sm', manualResultColors[manualResult.status])}>
                  <p className={clsx('font-semibold', statusLabel(manualResult.status).color)}>
                    {manualResult.status === 'returned' && '✓ Return Recorded'}
                    {manualResult.status === 'already_done' && '⚠ Already Processed'}
                    {manualResult.status === 'not_found' && '✗ Not Found'}
                  </p>
                  {manualResult.customerName && (
                    <p className="text-gray-600 dark:text-slate-400 mt-1">
                      {manualResult.customerName}
                      {manualResult.externalOrderId && ` · Order #${manualResult.externalOrderId}`}
                    </p>
                  )}
                  {!manualResult.customerName && (
                    <p className="text-gray-500 dark:text-slate-400 mt-1">{manualResult.message}</p>
                  )}
                </div>
              )}
            </div>
          )}
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
              <p className="text-sm text-gray-400 dark:text-slate-500">Koi scan nahi hua abhi tak</p>
              <p className="text-xs text-gray-300 dark:text-slate-600 mt-1">
                Barcode scanner se parcel scan karo ya manual entry use karo
              </p>
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
