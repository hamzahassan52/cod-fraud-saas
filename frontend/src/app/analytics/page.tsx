'use client';

import { useEffect, useState } from 'react';
import { analyticsApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { RevenueSavedChart } from '@/components/charts/RevenueSavedChart';
import { RiskTrendChart } from '@/components/charts/RiskTrendChart';
import { RiskDistributionChart } from '@/components/charts/RiskDistributionChart';
import { FraudTriggerChart } from '@/components/charts/FraudTriggerChart';
import clsx from 'clsx';

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
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
        <div className="flex h-96 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
            <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">Loading analytics...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) {
    return (
      <DashboardLayout>
        <div className="p-8 text-center text-gray-500 dark:text-slate-400">Failed to load analytics</div>
      </DashboardLayout>
    );
  }

  const { summary } = data;

  // Prepare chart data
  const riskChartData = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((level) => {
    const item = data.riskDistribution.find((r: any) => r.risk_level === level);
    const colors = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#991b1b' };
    return { name: level, value: item ? parseInt(item.count) : 0, color: colors[level] };
  }).filter((d) => d.value > 0);

  const avgOrderValue = summary.totalOrders > 0 ? summary.totalRevenue / summary.totalOrders : 0;

  const revenueTrend = data.dailyOrders.slice(0, 30).reverse().map((day: any) => ({
    date: new Date(day.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    revenue_saved: (parseInt(day.blocked || 0)) * avgOrderValue,
  }));

  const riskTrend = data.dailyOrders.slice(0, 30).reverse().map((day: any) => ({
    date: new Date(day.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    high: parseInt(day.blocked || 0),
    medium: parseInt(day.rto || 0),
    low: parseInt(day.delivered || 0),
  }));

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Analytics</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">Detailed fraud detection insights</p>
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
                    : 'text-gray-500 hover:text-gray-700 dark:text-slate-400'
                )}
              >
                {d} days
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <p className="text-sm text-gray-500 dark:text-slate-400">RTO Rate</p>
            <p className={clsx('mt-1 text-3xl font-bold', summary.rtoRate > 20 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
              {summary.rtoRate}%
            </p>
            <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{summary.totalRto} returns of {summary.totalRto + summary.totalDelivered} completed</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <p className="text-sm text-gray-500 dark:text-slate-400">Avg Risk Score</p>
            <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{summary.avgRiskScore || 0}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <p className="text-sm text-gray-500 dark:text-slate-400">Orders Blocked</p>
            <p className="mt-1 text-3xl font-bold text-red-600 dark:text-red-400">{summary.blocked}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
            <p className="text-sm text-gray-500 dark:text-slate-400">Revenue Protected</p>
            <p className="mt-1 text-3xl font-bold text-blue-600 dark:text-blue-400">PKR {((summary.blocked * avgOrderValue) / 1000).toFixed(0)}K</p>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="RTO Trend">
            <RiskTrendChart data={riskTrend} />
          </Card>
          <Card title="Revenue Saved Trend">
            <RevenueSavedChart data={revenueTrend} />
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Risk Category Breakdown">
            <RiskDistributionChart data={riskChartData} />
          </Card>
          <Card title="Top Fraud Signals">
            <FraudTriggerChart data={data.topFraudSignals} />
          </Card>
        </div>

        {/* City Risk Table */}
        <Card title="City Risk Insights">
          {data.topRtoCities.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-400 dark:text-slate-500">No city data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:border-slate-700 dark:text-slate-400">
                    <th className="py-2 text-left">City</th>
                    <th className="py-2 text-right">Total Orders</th>
                    <th className="py-2 text-right">Delivered</th>
                    <th className="py-2 text-right">RTO</th>
                    <th className="py-2 text-right">RTO Rate</th>
                    <th className="py-2 text-right">Risk Level</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topRtoCities.map((city: any) => {
                    const rate = parseFloat(city.rto_rate);
                    return (
                      <tr key={city.city} className="border-b border-gray-50 dark:border-slate-700/50">
                        <td className="py-2.5 font-medium text-gray-900 dark:text-slate-200">{city.city}</td>
                        <td className="py-2.5 text-right text-gray-600 dark:text-slate-400">{city.total}</td>
                        <td className="py-2.5 text-right text-green-600 dark:text-green-400">{parseInt(city.total) - parseInt(city.rto)}</td>
                        <td className="py-2.5 text-right text-red-600 dark:text-red-400">{city.rto}</td>
                        <td className="py-2.5 text-right">
                          <span className={clsx('font-semibold', rate > 30 ? 'text-red-600 dark:text-red-400' : rate > 15 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400')}>
                            {city.rto_rate}%
                          </span>
                        </td>
                        <td className="py-2.5 text-right">
                          <span className={clsx(
                            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                            rate > 30 ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400' :
                            rate > 15 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' :
                            'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
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
    </DashboardLayout>
  );
}
