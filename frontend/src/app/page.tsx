'use client';

import { useEffect, useState } from 'react';
import { analyticsApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { RiskDistributionChart } from '@/components/charts/RiskDistributionChart';
import { RevenueSavedChart } from '@/components/charts/RevenueSavedChart';
import { RiskTrendChart } from '@/components/charts/RiskTrendChart';
import { FraudTriggerChart } from '@/components/charts/FraudTriggerChart';
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

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    analyticsApi.dashboard(days)
      .then((res) => setData(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-3">Loading analytics...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-gray-500 dark:text-slate-400">Failed to load dashboard data</div>
      </DashboardLayout>
    );
  }

  const { summary } = data;
  const needsReview = summary.verify || 0;

  // Prepare chart data
  const riskChartData = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((level) => {
    const item = data.riskDistribution.find((r: any) => r.risk_level === level);
    const colors = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#991b1b' };
    return { name: level, value: item ? parseInt(item.count) : 0, color: colors[level] };
  }).filter((d) => d.value > 0);

  // Revenue saved trend from daily data
  const revenueTrend = data.dailyOrders.slice(0, 14).reverse().map((day: any) => ({
    date: new Date(day.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    revenue_saved: (parseInt(day.blocked || 0)) * (summary.totalRevenue / Math.max(summary.totalOrders, 1)),
  }));

  // Risk trend from daily data
  const riskTrend = data.dailyOrders.slice(0, 14).reverse().map((day: any) => ({
    date: new Date(day.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    high: parseInt(day.blocked || 0),
    medium: parseInt(day.rto || 0),
    low: parseInt(day.delivered || 0),
  }));

  // Estimated revenue protected = blocked orders * avg order value
  const avgOrderValue = summary.totalOrders > 0 ? summary.totalRevenue / summary.totalOrders : 0;
  const revenueProtected = summary.blocked * avgOrderValue;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header with period selector */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Dashboard</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">Revenue Protection Control Center</p>
          </div>
          <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-slate-800">
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={clsx(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  days === d
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
                )}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Alert Banner */}
        {needsReview > 0 && (
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800 dark:bg-amber-900/20">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                  {needsReview} Orders Require Review
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  These orders have been flagged for manual verification
                </p>
              </div>
            </div>
            <Link
              href="/orders?recommendation=VERIFY"
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
            >
              Review Now
            </Link>
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Total Orders" value={summary.totalOrders.toLocaleString()} />
          <StatCard
            label="High Risk"
            value={summary.blocked.toLocaleString()}
            icon={
              <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            }
          />
          <StatCard label="Suspicious" value={summary.verify.toLocaleString()} />
          <StatCard label="Approved" value={summary.approved.toLocaleString()} />
          <StatCard
            label="RTO Rate"
            value={`${summary.rtoRate}%`}
            changeType={summary.rtoRate > 20 ? 'down' : 'up'}
          />
          <StatCard
            label="Revenue Protected"
            value={`PKR ${(revenueProtected / 1000).toFixed(0)}K`}
            highlight
          />
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Risk Distribution">
            <RiskDistributionChart data={riskChartData} />
          </Card>
          <Card title="Revenue Saved Trend">
            <RevenueSavedChart data={revenueTrend} />
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Risk Trend">
            <RiskTrendChart data={riskTrend} />
          </Card>
          <Card title="Top Fraud Triggers">
            <FraudTriggerChart data={data.topFraudSignals} />
          </Card>
        </div>

        {/* Bottom Row: Cities + Platform */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Top RTO Cities */}
          <Card title="High-RTO Cities">
            {data.topRtoCities.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-400 dark:text-slate-500">Not enough data</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-700">
                      <th className="py-2 text-left text-gray-500 dark:text-slate-400">City</th>
                      <th className="py-2 text-right text-gray-500 dark:text-slate-400">Orders</th>
                      <th className="py-2 text-right text-gray-500 dark:text-slate-400">RTO</th>
                      <th className="py-2 text-right text-gray-500 dark:text-slate-400">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topRtoCities.map((city: any) => (
                      <tr key={city.city} className="border-b border-gray-50 dark:border-slate-700/50">
                        <td className="py-2 font-medium text-gray-700 dark:text-slate-300">{city.city}</td>
                        <td className="py-2 text-right text-gray-500 dark:text-slate-400">{city.total}</td>
                        <td className="py-2 text-right text-red-600 dark:text-red-400">{city.rto}</td>
                        <td className="py-2 text-right">
                          <span className={clsx(
                            'font-semibold',
                            parseFloat(city.rto_rate) > 30 ? 'text-red-600 dark:text-red-400' :
                            parseFloat(city.rto_rate) > 15 ? 'text-amber-600 dark:text-amber-400' :
                            'text-green-600 dark:text-green-400'
                          )}>
                            {city.rto_rate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Platform Breakdown */}
          <Card title="Platform Breakdown">
            {!data.platformBreakdown?.length ? (
              <p className="py-4 text-center text-sm text-gray-400 dark:text-slate-500">No platform data</p>
            ) : (
              <div className="space-y-4">
                {data.platformBreakdown.map((p: any) => {
                  const total = parseInt(p.count) || 0;
                  const rto = parseInt(p.rto_count) || 0;
                  const pct = summary.totalOrders > 0 ? Math.min((total / summary.totalOrders) * 100, 100) : 0;
                  return (
                    <div key={p.platform} className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-sm font-medium capitalize text-gray-700 dark:text-slate-300">{p.platform}</span>
                          <div className="text-xs text-gray-500 dark:text-slate-400">
                            {total.toLocaleString()} orders
                            {rto > 0 && <span className="ml-2 text-red-500">({rto} RTO)</span>}
                          </div>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
                          <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
