'use client';

import { useEffect, useState } from 'react';
import { analyticsApi, mlApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import Link from 'next/link';
import clsx from 'clsx';

interface DashboardData {
  summary: {
    totalOrders: number;
    approved: number;
    blocked: number;
    verify: number;
    totalRto: number;
    totalDelivered: number;
    rtoRate: number;
    avgRiskScore: number;
    totalRevenue: number;
  };
  dailyOrders: any[];
  topFraudSignals: any[];
  riskDistribution: any[];
  topRtoCities: any[];
  platformBreakdown: any[];
}

interface MLMetrics {
  accuracy?: number;
  f1_score?: number;
  model_version?: string;
}

function calcDeltaPct(today: number, yesterday: number): number | undefined {
  if (yesterday === 0) return undefined;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [mlMetrics, setMlMetrics] = useState<MLMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.dashboard(days),
      mlApi.metrics().catch(() => ({ data: null })),
    ])
      .then(([analyticsRes, mlRes]) => {
        setData(analyticsRes.data);
        if (mlRes.data) setMlMetrics(mlRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-3">Loading dashboard...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
            <svg className="h-8 w-8 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-slate-400 font-medium">Failed to load dashboard data</p>
          <p className="text-sm text-gray-400 dark:text-slate-500">Check your connection and try again</p>
        </div>
      </DashboardLayout>
    );
  }

  const { summary } = data;
  const needsReview = summary.verify || 0;

  // Avg order value
  const avgOrderValue = summary.totalOrders > 0 ? summary.totalRevenue / summary.totalOrders : 0;
  const revenueProtected = summary.blocked * avgOrderValue;

  // Today vs yesterday deltas from dailyOrders (sorted DESC by date)
  const today = data.dailyOrders[0];
  const yesterday = data.dailyOrders[1];
  const todayBlocked = parseInt(today?.blocked || 0);
  const yesterdayBlocked = parseInt(yesterday?.blocked || 0);
  const todayVerify = parseInt(today?.rto || 0) + parseInt(today?.total || 0) - parseInt(today?.delivered || 0) - parseInt(today?.blocked || 0);
  const yesterdayVerify = parseInt(yesterday?.rto || 0) + parseInt(yesterday?.total || 0) - parseInt(yesterday?.delivered || 0) - parseInt(yesterday?.blocked || 0);
  const todayRto = parseInt(today?.rto || 0);
  const yesterdayRto = parseInt(yesterday?.rto || 0);
  const todayTotal = parseInt(today?.total || 0);
  const yesterdayTotal = parseInt(yesterday?.total || 0);

  const blockedDelta = calcDeltaPct(todayBlocked, yesterdayBlocked);
  const verifyDelta = calcDeltaPct(todayVerify, yesterdayVerify);
  const rtoDelta = calcDeltaPct(todayRto, yesterdayRto);
  const totalDelta = calcDeltaPct(todayTotal, yesterdayTotal);

  // Model health
  const accuracy = mlMetrics?.accuracy ? Math.round(mlMetrics.accuracy * 100) : null;
  const f1Score = mlMetrics?.f1_score ? Math.round(mlMetrics.f1_score * 100) : null;
  const isHealthy = accuracy !== null ? accuracy >= 80 : null;

  // Estimated risk exposure for VERIFY orders
  const riskExposure = needsReview * avgOrderValue;
  const avgRiskScore = summary.avgRiskScore || 0;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Fraud Control Panel</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">Real-time operational overview</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
            {[
              { label: 'Today', value: 1 },
              { label: '7d', value: 7 },
            ].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setDays(value)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  days === value
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders Requiring Review — Prominent Card */}
        {needsReview > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/20">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40">
                  <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <p className="text-base font-semibold text-amber-900 dark:text-amber-200">
                    {needsReview} Orders Need Immediate Review
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-4 text-sm text-amber-700 dark:text-amber-400">
                    {riskExposure > 0 && (
                      <span>Estimated risk exposure: <strong>PKR {(riskExposure / 1000).toFixed(0)}K</strong></span>
                    )}
                    {avgRiskScore > 0 && (
                      <span>Avg risk score: <strong>{avgRiskScore}/100</strong></span>
                    )}
                  </div>
                </div>
              </div>
              <Link
                href="/orders?recommendation=VERIFY"
                className="flex-shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                Review Now →
              </Link>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Total Orders"
            value={summary.totalOrders.toLocaleString()}
            change={totalDelta}
            changeType={totalDelta !== undefined ? (totalDelta >= 0 ? 'up' : 'down') : 'neutral'}
          />
          <StatCard
            label="High Risk"
            value={summary.blocked.toLocaleString()}
            change={blockedDelta}
            changeType={blockedDelta !== undefined ? (blockedDelta > 0 ? 'down' : 'up') : 'neutral'}
            icon={
              <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
          />
          <StatCard
            label="Suspicious"
            value={summary.verify.toLocaleString()}
            change={verifyDelta}
            changeType={verifyDelta !== undefined ? (verifyDelta > 0 ? 'down' : 'up') : 'neutral'}
          />
          <StatCard label="Approved" value={summary.approved.toLocaleString()} />
          <StatCard
            label="RTO Rate"
            value={`${summary.rtoRate}%`}
            change={rtoDelta}
            changeType={rtoDelta !== undefined ? (rtoDelta > 0 ? 'down' : 'up') : 'neutral'}
          />
          <StatCard
            label="Revenue Protected"
            value={`PKR ${(revenueProtected / 1000).toFixed(0)}K`}
            highlight
          />
        </div>

        {/* Bottom Row: Model Health + Recent Activity */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Model Health Widget */}
          <Card title="AI Model Health">
            {mlMetrics ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 dark:text-slate-400">Status</span>
                  <span className={clsx(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
                    isHealthy
                      ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                  )}>
                    <span className={clsx('h-1.5 w-1.5 rounded-full', isHealthy ? 'bg-green-500' : 'bg-amber-500')} />
                    {isHealthy ? 'Healthy' : 'Needs Monitoring'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-gray-50 dark:bg-slate-700/50 p-3">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Accuracy</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">{accuracy !== null ? `${accuracy}%` : '—'}</p>
                  </div>
                  <div className="rounded-lg bg-gray-50 dark:bg-slate-700/50 p-3">
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">F1 Score</p>
                    <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-slate-100">{f1Score !== null ? `${f1Score}%` : '—'}</p>
                  </div>
                </div>
                {mlMetrics.model_version && (
                  <p className="text-xs text-gray-400 dark:text-slate-500">
                    Model version: <span className="font-mono">{mlMetrics.model_version}</span>
                  </p>
                )}
                <Link
                  href="/ml"
                  className="block text-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View full ML insights →
                </Link>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700">
                  <svg className="h-6 w-6 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400">ML service unavailable</p>
              </div>
            )}
          </Card>

          {/* Top Fraud Signals (mini) */}
          <Card title="Top Fraud Signals">
            {!data.topFraudSignals?.length ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700">
                  <svg className="h-6 w-6 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                </div>
                <p className="text-sm text-gray-500 dark:text-slate-400">No fraud signals recorded yet</p>
                <p className="text-xs text-gray-400 dark:text-slate-500">Signals will appear as orders are processed</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.topFraudSignals.slice(0, 6).map((signal: any, idx: number) => {
                  const count = parseInt(signal.count || 0);
                  const maxCount = parseInt(data.topFraudSignals[0]?.count || 1);
                  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                  return (
                    <div key={idx} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-700 dark:text-slate-300 truncate">
                            {(signal.signal_name || signal.signal_type || signal.signal || 'Unknown').replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs text-gray-500 dark:text-slate-400 flex-shrink-0">{count}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
                          <div
                            className="h-1.5 rounded-full bg-red-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <Link
                  href="/analytics"
                  className="block pt-1 text-center text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  View full analytics →
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
