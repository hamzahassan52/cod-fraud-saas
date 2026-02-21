'use client';

import { useEffect, useState } from 'react';
import { analyticsApi, mlApi, ordersApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { RiskDistributionChart } from '@/components/charts/RiskDistributionChart';
import { RevenueSavedChart } from '@/components/charts/RevenueSavedChart';
import { FraudTriggerChart } from '@/components/charts/FraudTriggerChart';
import Link from 'next/link';
import clsx from 'clsx';

const COURIER_COST = 300;
const SUBSCRIPTION_COST = 5000;

function formatK(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return Math.round(v).toString();
}

function Sparkline({ data, color = '#10b981' }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null;
  const W = 72, H = 28;
  const max = Math.max(...data, 1), min = Math.min(...data, 0), range = max - min || 1;
  const pts = data.map((v, i) =>
    `${((i / (data.length - 1)) * W).toFixed(1)},${(H - ((v - min) / range) * (H - 4) - 2).toFixed(1)}`
  );
  return (
    <svg width={W} height={H} className="opacity-80">
      <path d={`M ${pts.join(' L ')}`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FinancialCard({
  label, value, subtitle, delta, lowerIsBetter = false, sparkData, highlight, badge,
}: {
  label: string; value: string; subtitle?: string; delta?: number | null;
  lowerIsBetter?: boolean; sparkData?: number[]; highlight?: boolean; badge?: string;
}) {
  const isPositive = delta != null ? (lowerIsBetter ? delta < 0 : delta > 0) : null;
  return (
    <div className={clsx(
      'rounded-xl border p-6 shadow-sm',
      highlight
        ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20'
        : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800'
    )}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{label}</p>
          {badge && (
            <span className="mt-1 inline-block rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:text-indigo-400">
              {badge}
            </span>
          )}
          <p className={clsx(
            'mt-2 text-3xl font-bold tracking-tight',
            highlight ? 'text-emerald-700 dark:text-emerald-400' : 'text-gray-900 dark:text-slate-100'
          )}>
            {value}
          </p>
          {delta != null && (
            <div className="mt-1.5 flex items-center gap-1">
              <span className={clsx(
                'flex items-center gap-0.5 text-xs font-semibold',
                isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
              )}>
                {isPositive
                  ? <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" /></svg>
                  : <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" /></svg>
                }
                {Math.abs(delta)}%
              </span>
              <span className="text-xs text-gray-400 dark:text-slate-400">vs prior period</span>
            </div>
          )}
          {subtitle && <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        {sparkData && sparkData.length > 1 && (
          <div className="ml-3 mt-1 flex-shrink-0">
            <Sparkline data={sparkData} color={highlight ? '#10b981' : '#6366f1'} />
          </div>
        )}
      </div>
    </div>
  );
}

function AIMetricCard({ label, value, subtitle, status = 'neutral' }: {
  label: string; value: string; subtitle?: string; status?: 'healthy' | 'warning' | 'neutral';
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-base font-semibold text-gray-900 dark:text-slate-100">{label}</p>
        {status !== 'neutral' && (
          <span className={clsx('h-2.5 w-2.5 rounded-full flex-shrink-0', status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500')} />
        )}
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-slate-100">{value}</p>
      {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-slate-400 truncate">{subtitle}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState<any>(null);
  const [priorData, setPriorData] = useState<any>(null);
  const [mlMetrics, setMlMetrics] = useState<any>(null);
  const [urgentOrders, setUrgentOrders] = useState<any[]>([]);
  const [perfData, setPerfData] = useState<any>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [refreshTime, setRefreshTime] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.dashboard(days),
      analyticsApi.dashboard(days * 2).catch(() => ({ data: null })),
      mlApi.metrics().catch(() => ({ data: null })),
      ordersApi.list({ recommendation: 'VERIFY', limit: 5, sortBy: 'risk_score', sortOrder: 'desc' }).catch(() => ({ data: { orders: [] } })),
      analyticsApi.performance().catch(() => ({ data: null })),
    ]).then(([curr, prior, ml, urgent, perf]) => {
      setData(curr.data);
      setPriorData(prior.data);
      setMlMetrics(ml.data);
      setUrgentOrders(urgent.data?.orders || []);
      setPerfData(perf.data);
      setRefreshTime(new Date().toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' }));
    }).catch(console.error).finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex h-96 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
            <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">Loading dashboard...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-96 gap-3">
          <p className="text-gray-500 dark:text-slate-400 font-medium">Failed to load dashboard</p>
        </div>
      </DashboardLayout>
    );
  }

  const { summary } = data;
  const avgOrderValue = summary.totalOrders > 0 ? summary.totalRevenue / summary.totalOrders : 0;

  // Financial
  const capitalProtected = summary.blocked * avgOrderValue;
  const courierSaved = summary.blocked * COURIER_COST;
  const estLossPrevented = capitalProtected + courierSaved;
  const roiMultiple = SUBSCRIPTION_COST > 0 ? Math.round(estLossPrevented / SUBSCRIPTION_COST) : 0;

  // Prior period comparison
  const priorBlocked = priorData ? priorData.summary.blocked - summary.blocked : null;
  const priorCapital = priorBlocked != null ? priorBlocked * avgOrderValue : null;
  const priorEstLoss = priorCapital != null ? priorCapital + priorBlocked! * COURIER_COST : null;
  const capitalDelta = priorCapital && priorCapital > 0 ? Math.round((capitalProtected - priorCapital) / priorCapital * 100) : null;
  const lossDelta = priorEstLoss && priorEstLoss > 0 ? Math.round((estLossPrevented - priorEstLoss) / priorEstLoss * 100) : null;

  const priorRtoN = priorData ? priorData.summary.totalRto - summary.totalRto : null;
  const priorDelN = priorData ? priorData.summary.totalDelivered - summary.totalDelivered : null;
  const priorRtoRate = priorRtoN != null && priorDelN != null && (priorRtoN + priorDelN) > 0
    ? Math.round(priorRtoN / (priorRtoN + priorDelN) * 1000) / 10 : null;
  const rtoDelta = priorRtoRate != null ? Math.round((summary.rtoRate - priorRtoRate) * 10) / 10 : null;

  // Sparklines — sorted oldest to newest
  const dailySorted = [...data.dailyOrders].reverse();
  const revenueSparkData = dailySorted.map((d: any) => parseInt(d.blocked || 0) * avgOrderValue);
  const blockedSparkData = dailySorted.map((d: any) => parseInt(d.blocked || 0));

  // Charts
  const riskChartData = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((level) => {
    const item = data.riskDistribution.find((r: any) => r.risk_level === level);
    const colors = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#991b1b' };
    return { name: level, value: item ? parseInt(item.count) : 0, color: colors[level] };
  }).filter(d => d.value > 0);

  const revenueTrend = dailySorted.slice(-Math.min(days, 14)).map((d: any) => ({
    date: new Date(d.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    revenue_saved: parseInt(d.blocked || 0) * avgOrderValue,
  }));

  // ML
  const accuracy = mlMetrics?.accuracy ? Math.round(mlMetrics.accuracy * 100) : null;
  const f1 = mlMetrics?.f1_score ? Math.round(mlMetrics.f1_score * 100) : null;
  const isModelHealthy = accuracy != null ? accuracy >= 80 : null;

  const modelVersion: string = mlMetrics?.model_version || '';
  let modelAge: number | null = null;
  const mv = modelVersion.match(/v(\d{8})/);
  if (mv) {
    const ds = mv[1];
    modelAge = Math.floor((Date.now() - new Date(parseInt(ds.slice(0,4)), parseInt(ds.slice(4,6))-1, parseInt(ds.slice(6,8))).getTime()) / 86400000);
  }

  const needsReview = summary.verify || 0;
  const riskExposure = needsReview * avgOrderValue;

  return (
    <DashboardLayout>
      <div className="space-y-8">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 sm:text-2xl">Revenue Protection Command Center</h1>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live
              </span>
            </div>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">
              Your capital shield — active and protecting · Refreshed at {refreshTime}
            </p>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800 self-start sm:self-auto">
            {[{ label: 'Last 24h', value: 1 }, { label: 'Last 7 Days', value: 7 }].map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setDays(value)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  days === value
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Layer 1: Financial Impact */}
        <section>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Financial Impact</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <FinancialCard
              label="Capital Protected"
              value={`PKR ${formatK(capitalProtected)}`}
              subtitle={`${summary.blocked} orders blocked`}
              delta={capitalDelta}
              sparkData={revenueSparkData}
              highlight
            />
            <FinancialCard
              label="Estimated Loss Prevented"
              value={`PKR ${formatK(estLossPrevented)}`}
              subtitle={`Incl. PKR ${formatK(courierSaved)} courier saved`}
              delta={lossDelta}
              sparkData={revenueSparkData.map((v: number) => v * 1.16)}
              badge="Product + Courier"
            />
            <FinancialCard
              label="Net Revenue Saved"
              value={`PKR ${formatK(estLossPrevented)}`}
              subtitle="Total financial exposure averted"
              delta={lossDelta}
              sparkData={blockedSparkData}
            />
            <FinancialCard
              label="Protection ROI"
              value={`${roiMultiple}×`}
              subtitle={`Every PKR 1 spent → PKR ${roiMultiple} protected`}
              badge="vs subscription"
            />
          </div>
        </section>

        {/* Layer 2: Risk Overview */}
        <section>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Risk Overview</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">Total Orders</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-slate-100">{summary.totalOrders.toLocaleString()}</p>
              {priorData && (
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">Prior period: {(priorData.summary.totalOrders - summary.totalOrders).toLocaleString()}</p>
              )}
            </div>

            <div className="rounded-xl border border-red-100 bg-red-50 p-6 dark:border-red-900/40 dark:bg-red-900/10">
              <p className="text-base font-semibold text-red-700 dark:text-red-300">Blocked — Revenue Saved</p>
              <p className="mt-2 text-3xl font-bold text-red-700 dark:text-red-300">{summary.blocked.toLocaleString()}</p>
              <p className="mt-1 text-xs text-red-500 dark:text-red-400">
                {summary.totalOrders > 0 ? Math.round(summary.blocked / summary.totalOrders * 100) : 0}% block rate
              </p>
            </div>

            <div className="rounded-xl border border-amber-100 bg-amber-50 p-6 dark:border-amber-900/40 dark:bg-amber-900/10">
              <p className="text-base font-semibold text-amber-700 dark:text-amber-300">Under Review</p>
              <p className="mt-2 text-3xl font-bold text-amber-700 dark:text-amber-300">{summary.verify.toLocaleString()}</p>
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Awaiting manual decision</p>
            </div>

            <div className={clsx(
              'rounded-xl border p-6',
              summary.rtoRate > 20
                ? 'border-red-100 bg-red-50 dark:border-red-900/40 dark:bg-red-900/10'
                : summary.rtoRate > 10
                ? 'border-amber-100 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/10'
                : 'border-emerald-100 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/10'
            )}>
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">Return-to-Origin Rate</p>
              <p className={clsx(
                'mt-2 text-3xl font-bold',
                summary.rtoRate > 20 ? 'text-red-700 dark:text-red-300' :
                summary.rtoRate > 10 ? 'text-amber-700 dark:text-amber-300' :
                'text-emerald-700 dark:text-emerald-300'
              )}>
                {summary.rtoRate}%
              </p>
              {rtoDelta != null && (
                <p className={clsx('mt-1 text-xs font-semibold', rtoDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')}>
                  {rtoDelta < 0 ? '▼' : '▲'} {Math.abs(rtoDelta)} pts vs prior {days}d
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Urgent Orders Banner */}
        {needsReview > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100 dark:bg-amber-900/40">
                  <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">{needsReview} Orders Require Immediate Review</p>
                  <div className="mt-0.5 flex flex-wrap gap-4 text-xs text-amber-700 dark:text-amber-400">
                    {riskExposure > 0 && <span>Risk exposure: <strong>PKR {formatK(riskExposure)}</strong></span>}
                    <span>Avg risk score: <strong>{summary.avgRiskScore}/100</strong></span>
                  </div>
                </div>
              </div>
              <Link href="/orders?recommendation=VERIFY" className="self-start rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors sm:self-auto sm:flex-shrink-0">
                Review Now →
              </Link>
            </div>
          </div>
        )}

        {/* Layer 3: Trends */}
        <section>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Trends</p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title="Capital Protected — Daily Trend">
                <RevenueSavedChart data={revenueTrend} />
              </Card>
            </div>
            <Card title="RTO Rate Comparison">
              <div className="space-y-5 py-2">
                <div>
                  <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">Current {days === 1 ? '24h' : `${days}d`}</p>
                  <div className="flex items-end gap-2 mt-1">
                    <p className={clsx(
                      'text-4xl font-bold',
                      summary.rtoRate > 20 ? 'text-red-600 dark:text-red-400' :
                      summary.rtoRate > 10 ? 'text-amber-600 dark:text-amber-400' :
                      'text-emerald-600 dark:text-emerald-400'
                    )}>
                      {summary.rtoRate}%
                    </p>
                    {rtoDelta != null && (
                      <span className={clsx('mb-1.5 text-sm font-semibold', rtoDelta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400')}>
                        {rtoDelta < 0 ? '▼' : '▲'}{Math.abs(rtoDelta)} pts
                      </span>
                    )}
                  </div>
                </div>
                {priorRtoRate != null && (
                  <div className="border-t border-gray-100 dark:border-slate-700 pt-4">
                    <p className="text-sm font-semibold text-gray-600 dark:text-slate-300">Prior {days === 1 ? '24h' : `${days}d`}</p>
                    <p className="mt-1 text-2xl font-semibold text-gray-500 dark:text-slate-400">{priorRtoRate}%</p>
                  </div>
                )}
                <div className="border-t border-gray-100 dark:border-slate-700 pt-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500 dark:text-slate-400">Pakistan industry avg</span>
                    <span className="font-medium text-gray-600 dark:text-slate-300">25–35%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500 dark:text-slate-400">Your performance</span>
                    <span className={clsx('font-semibold', summary.rtoRate < 20 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                      {summary.rtoRate < 20 ? '✓ Above average' : 'Needs attention'}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </section>

        {/* Layer 4: Risk & Intelligence */}
        <section>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Risk & Intelligence</p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Risk Distribution">
              {riskChartData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <p className="text-sm text-gray-500 dark:text-slate-400">No risk data yet</p>
                </div>
              ) : (
                <RiskDistributionChart data={riskChartData} />
              )}
            </Card>
            <Card title="Primary Risk Triggers">
              <FraudTriggerChart data={data.topFraudSignals} />
            </Card>
          </div>
        </section>

        {/* Layer 5: Operational Action */}
        <section>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Operational Action</p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Orders Requiring Action" subtitle="Highest risk, awaiting review">
              {urgentOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                    <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">All clear — no pending reviews</p>
                </div>
              ) : (
                <div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-slate-700 text-xs uppercase tracking-widest text-gray-500 dark:text-slate-400">
                          <th className="py-2 text-left">Customer</th>
                          <th className="py-2 text-right">Amount</th>
                          <th className="py-2 text-right">Risk Score</th>
                          <th className="py-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {urgentOrders.map((order: any) => (
                          <tr key={order.id} className="border-b border-gray-50 dark:border-slate-700/50">
                            <td className="py-2.5">
                              <p className="font-medium text-gray-900 dark:text-slate-200">{order.customer_name || '—'}</p>
                              <p className="text-xs text-gray-500 dark:text-slate-400">{order.shipping_city || ''}</p>
                            </td>
                            <td className="py-2.5 text-right text-gray-600 dark:text-slate-400 text-xs">
                              PKR {parseInt(order.total_amount || 0).toLocaleString()}
                            </td>
                            <td className="py-2.5 text-right">
                              <span className={clsx(
                                'inline-flex rounded-full px-2 py-0.5 text-xs font-bold',
                                parseFloat(order.risk_score) >= 70
                                  ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                              )}>
                                {order.risk_score ? Math.round(parseFloat(order.risk_score)) : '—'}
                              </span>
                            </td>
                            <td className="py-2.5 text-right">
                              <Link href={`/orders/${order.id}`} className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
                                Review →
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {needsReview > 5 && (
                    <div className="mt-3 text-right">
                      <Link href="/orders?recommendation=VERIFY" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                        View all {needsReview} pending orders →
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </Card>

            <Card title="High-Risk Cities" subtitle="Top return-to-origin locations">
              {data.topRtoCities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <p className="text-sm text-gray-500 dark:text-slate-400">No city data yet</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Appears after 5+ orders per city</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-700 text-xs uppercase tracking-widest text-gray-500 dark:text-slate-400">
                        <th className="py-2 text-left">City</th>
                        <th className="py-2 text-right">Orders</th>
                        <th className="py-2 text-right">RTO</th>
                        <th className="py-2 text-right">Rate</th>
                        <th className="py-2 text-right">Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topRtoCities.map((city: any) => {
                        const rate = parseFloat(city.rto_rate);
                        return (
                          <tr key={city.city} className="border-b border-gray-50 dark:border-slate-700/50">
                            <td className="py-2.5 font-medium text-gray-900 dark:text-slate-200">{city.city}</td>
                            <td className="py-2.5 text-right text-gray-500 dark:text-slate-400">{city.total}</td>
                            <td className="py-2.5 text-right text-red-600 dark:text-red-400">{city.rto}</td>
                            <td className="py-2.5 text-right">
                              <span className={clsx('font-semibold', rate > 30 ? 'text-red-600 dark:text-red-400' : rate > 15 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                                {city.rto_rate}%
                              </span>
                            </td>
                            <td className="py-2.5 text-right">
                              <span className={clsx(
                                'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                rate > 30 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                                rate > 15 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' :
                                'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                              )}>
                                {rate > 30 ? 'HIGH' : rate > 15 ? 'MEDIUM' : 'LOW'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </section>

        {/* Layer 6: AI Engine Status */}
        <section>
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">AI Engine Status</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <AIMetricCard
              label="Model Accuracy"
              value={accuracy != null ? `${accuracy}%` : '—'}
              subtitle={accuracy != null ? (accuracy >= 80 ? 'Performing well' : 'Below threshold') : 'No active model'}
              status={isModelHealthy === true ? 'healthy' : isModelHealthy === false ? 'warning' : 'neutral'}
            />
            <AIMetricCard
              label="F1 Score"
              value={f1 != null ? `${f1}%` : '—'}
              subtitle="Precision–recall balance"
              status={f1 != null ? (f1 >= 75 ? 'healthy' : 'warning') : 'neutral'}
            />
            <AIMetricCard
              label="Avg Confidence"
              value={perfData?.avgConfidence != null ? `${Math.round(perfData.avgConfidence)}%` : '—'}
              subtitle="Per prediction"
              status={perfData?.avgConfidence != null ? (perfData.avgConfidence >= 70 ? 'healthy' : 'warning') : 'neutral'}
            />
            <AIMetricCard
              label="False Positive Rate"
              value={perfData?.falsePositiveRate != null ? `${perfData.falsePositiveRate}%` : '—'}
              subtitle={perfData?.falsePositiveRate != null ? 'Blocked orders later delivered' : 'Needs feedback data'}
              status={perfData?.falsePositiveRate != null ? (perfData.falsePositiveRate <= 10 ? 'healthy' : 'warning') : 'neutral'}
            />
            <AIMetricCard
              label="Model Last Updated"
              value={modelAge != null ? `${modelAge}d ago` : '—'}
              subtitle={modelVersion || 'Unknown version'}
              status={modelAge != null ? (modelAge <= 30 ? 'healthy' : 'warning') : 'neutral'}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">Repeat Offender Orders</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-slate-100">
                {perfData?.repeatOffenderOrders != null ? perfData.repeatOffenderOrders : '—'}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Orders from phones with prior RTO history</p>
            </div>

            <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6">
              <p className="text-base font-semibold text-gray-900 dark:text-slate-100">Manual Override Rate</p>
              <p className="mt-2 text-3xl font-bold text-gray-900 dark:text-slate-100">
                {perfData?.overrideRate != null ? `${perfData.overrideRate}%` : '—'}
              </p>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Human corrections to AI decisions</p>
            </div>

            <div className={clsx(
              'rounded-xl border p-6',
              perfData?.fraudVelocityIndex != null && perfData.fraudVelocityIndex > 2
                ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/10'
                : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800'
            )}>
              <p className={clsx(
                'text-base font-semibold',
                perfData?.fraudVelocityIndex != null && perfData.fraudVelocityIndex > 2
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-gray-900 dark:text-slate-100'
              )}>
                Fraud Velocity Index
              </p>
              <p className={clsx(
                'mt-2 text-3xl font-bold',
                perfData?.fraudVelocityIndex != null && perfData.fraudVelocityIndex > 2
                  ? 'text-red-700 dark:text-red-300'
                  : 'text-gray-900 dark:text-slate-100'
              )}>
                {perfData?.fraudVelocityIndex != null ? `${perfData.fraudVelocityIndex}×` : '—'}
              </p>
              <p className={clsx(
                'mt-1 text-sm',
                perfData?.fraudVelocityIndex != null && perfData.fraudVelocityIndex > 2
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-gray-500 dark:text-slate-400'
              )}>
                {perfData?.fraudVelocityIndex != null && perfData.fraudVelocityIndex > 2
                  ? '⚠ Unusual spike in last hour'
                  : 'Normal fraud activity level'}
              </p>
            </div>
          </div>
        </section>

      </div>
    </DashboardLayout>
  );
}
