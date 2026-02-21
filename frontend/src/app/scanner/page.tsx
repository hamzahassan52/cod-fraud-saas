'use client';

import { useState, useRef, useEffect } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { scannerApi } from '@/lib/api';

type ScanResult = {
  success: boolean;
  result: 'marked_returned' | 'already_processed' | 'not_found';
  message: string;
  order?: {
    id: string;
    external_order_id: string;
    customer_name: string;
    risk_score: number;
    risk_level: string;
    original_recommendation: string;
    final_status: string;
  };
};

export default function ScannerPage() {
  const [trackingNumber, setTrackingNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<Array<{ tn: string; result: ScanResult; time: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [result]);

  const handleScan = async (tn?: string) => {
    const value = (tn || trackingNumber).trim().toUpperCase();
    if (!value) return;

    setLoading(true);
    setResult(null);

    try {
      const res = await scannerApi.scan(value);
      const scanResult: ScanResult = res.data;
      setResult(scanResult);
      setHistory(prev => [{ tn: value, result: scanResult, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
      setTrackingNumber('');
    } catch (err: any) {
      const errResult: ScanResult = {
        success: false,
        result: 'not_found',
        message: err.response?.data?.message || 'Order not found',
      };
      setResult(errResult);
      setHistory(prev => [{ tn: value, result: errResult, time: new Date().toLocaleTimeString() }, ...prev.slice(0, 9)]);
      setTrackingNumber('');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleScan();
  };

  const riskColor = (level: string) => {
    if (level === 'HIGH' || level === 'CRITICAL') return 'text-red-400';
    if (level === 'MEDIUM') return 'text-yellow-400';
    return 'text-green-400';
  };

  const resultBg = (r: ScanResult | null) => {
    if (!r) return '';
    if (r.result === 'marked_returned') return 'border-red-500/40 bg-red-500/10';
    if (r.result === 'already_processed') return 'border-yellow-500/40 bg-yellow-500/10';
    return 'border-gray-600 bg-gray-800/50';
  };

  const resultIcon = (r: ScanResult) => {
    if (r.result === 'marked_returned') return '📦';
    if (r.result === 'already_processed') return '⚠️';
    return '❌';
  };

  return (
    <DashboardLayout>
      <div className="max-w-2xl mx-auto py-8 px-4 sm:px-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Return Scanner</h1>
          <p className="text-gray-400 mt-1 text-sm">
            Scan or enter tracking number on returned parcel to mark as returned and record ML training data.
          </p>
        </div>

        {/* Scanner Input */}
        <div className="bg-gray-800/60 border border-gray-700 rounded-xl p-6 mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">
            Tracking Number
          </label>
          <div className="flex gap-3">
            <input
              ref={inputRef}
              type="text"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              placeholder="TRK-XXXXXX or scan barcode..."
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-white
                         placeholder-gray-500 focus:outline-none focus:border-blue-500 text-lg
                         font-mono tracking-wider"
              autoComplete="off"
              disabled={loading}
            />
            <button
              onClick={() => handleScan()}
              disabled={loading || !trackingNumber.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                         disabled:cursor-not-allowed text-white font-semibold rounded-lg
                         transition-colors min-w-[100px]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning
                </span>
              ) : 'Scan'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Press Enter or click Scan. Barcode scanner auto-submits on scan.
          </p>
        </div>

        {/* Result */}
        {result && (
          <div className={`border rounded-xl p-5 mb-6 transition-all ${resultBg(result)}`}>
            <div className="flex items-start gap-3">
              <span className="text-2xl">{resultIcon(result)}</span>
              <div className="flex-1">
                <p className={`font-semibold text-lg ${result.result === 'marked_returned' ? 'text-red-300' : result.result === 'already_processed' ? 'text-yellow-300' : 'text-gray-300'}`}>
                  {result.result === 'marked_returned' && 'Return Recorded'}
                  {result.result === 'already_processed' && 'Already Processed'}
                  {result.result === 'not_found' && 'Not Found'}
                </p>
                <p className="text-gray-400 text-sm mt-1">{result.message}</p>

                {result.order && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="bg-gray-900/60 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Customer</p>
                      <p className="text-white font-medium text-sm">{result.order.customer_name}</p>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Order #</p>
                      <p className="text-white font-mono text-sm">{result.order.external_order_id}</p>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">Original Risk Score</p>
                      <p className={`font-bold text-lg ${riskColor(result.order.risk_level)}`}>
                        {result.order.risk_score}/100
                        <span className="text-xs ml-1 font-normal">{result.order.risk_level}</span>
                      </p>
                    </div>
                    <div className="bg-gray-900/60 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-1">ML Signal</p>
                      <p className="text-green-400 text-sm font-medium">✓ Training data saved</p>
                      <p className="text-gray-500 text-xs">label = 1 (returned)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scan History */}
        {history.length > 0 && (
          <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700/50">
              <h2 className="text-sm font-semibold text-gray-300">Today's Scans</h2>
            </div>
            <div className="divide-y divide-gray-700/40">
              {history.map((item, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{resultIcon(item.result)}</span>
                    <div>
                      <p className="text-white font-mono text-sm">{item.tn}</p>
                      {item.result.order && (
                        <p className="text-gray-500 text-xs">{item.result.order.customer_name}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-xs font-medium ${item.result.result === 'marked_returned' ? 'text-red-400' : item.result.result === 'already_processed' ? 'text-yellow-400' : 'text-gray-500'}`}>
                      {item.result.result === 'marked_returned' ? 'Returned' : item.result.result === 'already_processed' ? 'Already done' : 'Not found'}
                    </p>
                    <p className="text-gray-600 text-xs">{item.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
