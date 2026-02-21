'use client';

import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
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
  const [stats, setStats] = useState<TrainingStats | null>(null);

  useEffect(() => {
    mlApi.trainingStats()
      .then(res => setStats(res.data))
      .catch(() => {});
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Return Scanner</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
            Physical barcode scanner se returns record karo. Koi manual input nahi.
          </p>
        </div>

        {/* How it works */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3">
            Scanner Kaise Kaam Karta Hai
          </h2>
          <ol className="space-y-2 text-sm text-blue-700 dark:text-blue-400">
            <li className="flex gap-2">
              <span className="font-bold flex-shrink-0">1.</span>
              <span>USB / Bluetooth barcode scanner computer mein connect karo</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold flex-shrink-0">2.</span>
              <span>Dashboard ka koi bhi page kholo — scanner page zaroori nahi</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold flex-shrink-0">3.</span>
              <span>Returned parcel ka barcode scanner ke saamne rakho</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold flex-shrink-0">4.</span>
              <span>
                <strong>Automatic</strong> — order DB mein update hota hai, screen pe notification aata hai, ML training data save hota hai
              </span>
            </li>
          </ol>
        </div>

        {/* Status indicator */}
        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              Scanner Active — Listening for barcode input
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Scanner kisi bhi page pe kaam karta hai. Yahan aane ki zaroorat nahi — yeh sirf status check page hai.
          </p>
        </div>

        {/* Training stats */}
        {stats && (
          <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">
              ML Training Data Progress
            </h2>

            <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2.5">
              <div
                className={clsx(
                  'h-2.5 rounded-full transition-all duration-700',
                  stats.readyToRetrain ? 'bg-green-500' :
                  stats.label1 > stats.threshold * 0.5 ? 'bg-blue-500' : 'bg-gray-400'
                )}
                style={{ width: `${Math.min((stats.label1 / stats.threshold) * 100, 100)}%` }}
              />
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-3">
                <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{stats.total}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Total Scanned</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                <p className="text-xl font-bold text-red-500">{stats.label1}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Returns (label 1)</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                <p className="text-xl font-bold text-green-600">{stats.label0}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Delivered (label 0)</p>
              </div>
            </div>

            <p className="text-xs text-gray-400 dark:text-slate-500">
              {stats.readyToRetrain
                ? '✅ Enough data to retrain ML model'
                : `${stats.threshold - stats.unused} more outcomes needed for auto-retrain`}
            </p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
