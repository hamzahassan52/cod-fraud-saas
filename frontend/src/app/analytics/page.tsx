'use client';

import { useEffect, useState } from 'react';
import { analyticsApi, mlApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { RevenueSavedChart } from '@/components/charts/RevenueSavedChart';
import { RiskTrendChart } from '@/components/charts/RiskTrendChart';
import { RiskDistributionChart } from '@/components/charts/RiskDistributionChart';
import { FraudTriggerChart } from '@/components/charts/FraudTriggerChart';
import clsx from 'clsx';

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [mlData, setMlData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.dashboard(days),
      mlApi.metrics().catch(() => ({ data: null })),
    ])
      .then(([analyticsRes, mlRes]) => {
        setData(analyticsRes.data);
        if (mlRes.data) setMlData(mlRes.data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  const exportCSV = () => {
    if (!data) return;
    const { summary, topRtoCities } = data;
    const rows = [
      ['Metric', 'Value'],
      ['Total Orders', summary.totalOrders],
      ['Approved', summary.approved],
      ['Blocked', summary.blocked],
      ['Verify', summary.verify],
      ['RTO Rate (%)', summary.rtoRate],
      ['Avg Risk Score', summary.avgRiskScore || 0],
      ['Total Revenue', summary.totalRevenue || 0],
      [],
      ['City', 'Total Orders', 'Delivered', 'RTO', 'RTO Rate (%)'],
      ...topRtoCities.map((c: any) => [
        c.city,
        c.total,
        parseInt(c.total) - parseInt(c.rto),
        c.rto,
        c.rto_rate,
      ]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fraud-analytics-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
        <div className="flex flex-col items-center justify-center h-96 gap-3">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-800">
            <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-slate-400 font-medium">Failed to load analytics</p>
        </div>
      </DashboardLayout>
    );
  }

  const { summary } = data;
  const avgOrderValue = summary.totalOrders > 0 ? summary.totalRevenue / summary.totalOrders : 0;
  const revenueProtected = (summary.blocked * avgOrderValue) / 1000;

  const riskChartData = (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const).map((level) => {
    const item = data.riskDistribution.find((r: any) => r.risk_level === level);
    const colors = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444', CRITICAL: '#991b1b' };
    return { name: level, value: item ? parseInt(item.count) : 0, color: colors[level] };
  }).filter((d) => d.value > 0);

  const revenueTrend = data.dailyOrders.slice(0, days).reverse().map((day: any) => ({
    date: new Date(day.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    revenue_saved: parseInt(day.blocked || 0) * avgOrderValue,
  }));

  const riskTrend = data.dailyOrders.slice(0, days).reverse().map((day: any) => ({
    date: new Date(day.date).toLocaleDateString('en-PK', { month: 'short', day: 'numeric' }),
    high: parseInt(day.blocked || 0),
    medium: parseInt(day.rto || 0),
    low: parseInt(day.delivered || 0),
  }));

  const mlAccuracy = mlData?.accuracy ? Math.round(mlData.accuracy * 100) : null;
  const mlPrecision = mlData?.precision ? Math.round(mlData.precision * 100) : null;
  const mlRecall = mlData?.recall ? Math.round(mlData.recall * 100) : null;
  const mlF1 = mlData?.f1_score ? Math.round(mlData.f1_score * 100) : null;
  const mlAuc = mlData?.auc_roc ? Math.round(mlData.auc_roc * 100) : null;

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Fraud Intelligence Lab</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">Strategic analysis and model performance</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export CSV
            </button>
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
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 1: Performance Metrics */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Performance Metrics</h2>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {/* Analytics KPIs */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">RTO Rate</p>
              <p className={clsx('mt-1 text-3xl font-bold', summary.rtoRate > 20 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400')}>
                {summary.rtoRate}%
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{summary.totalRto} of {summary.totalRto + summary.totalDelivered} completed</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">Avg Risk Score</p>
              <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{summary.avgRiskScore || 0}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">Out of 100</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">Orders Blocked</p>
              <p className="mt-1 text-3xl font-bold text-red-600 dark:text-red-400">{summary.blocked}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">High-risk orders stopped</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">Revenue Protected</p>
              <p className="mt-1 text-3xl font-bold text-blue-600 dark:text-blue-400">PKR {revenueProtected.toFixed(0)}K</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">Estimated savings</p>
            </div>

            {/* ML KPIs */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">ML Precision</p>
              <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{mlPrecision !== null ? `${mlPrecision}%` : '—'}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">True positive rate</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">ML Recall</p>
              <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{mlRecall !== null ? `${mlRecall}%` : '—'}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">Fraud detection rate</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">F1 Score</p>
              <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{mlF1 !== null ? `${mlF1}%` : '—'}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">Precision-recall balance</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-sm text-gray-500 dark:text-slate-400">AUC-ROC</p>
              <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-100">{mlAuc !== null ? `${mlAuc}%` : '—'}</p>
              <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">Discrimination ability</p>
            </div>
          </div>
        </section>

        {/* Section 2: Trend Analysis */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Trend Analysis</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Risk Trend">
              <RiskTrendChart data={riskTrend} />
            </Card>
            <Card title="Revenue Saved Trend">
              <RevenueSavedChart data={revenueTrend} />
            </Card>
          </div>
          <div className="mt-6">
            <Card title="Risk Category Breakdown">
              <RiskDistributionChart data={riskChartData} />
            </Card>
          </div>
        </section>

        {/* Section 3: Fraud Intelligence */}
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Fraud Intelligence</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Top Fraud Signals">
              <FraudTriggerChart data={data.topFraudSignals} />
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

          {/* Cities Table */}
          <div className="mt-6">
            <Card title="City Risk Insights">
              {data.topRtoCities.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-slate-700">
                    <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
                    </svg>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400">No city data available yet</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">City data will appear as orders are processed</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2 text-left">City</th>
                        <th className="py-2 text-right">Total</th>
                        <th className="py-2 text-right">Delivered</th>
                        <th className="py-2 text-right">RTO</th>
                        <th className="py-2 text-right">RTO Rate</th>
                        <th className="py-2 text-right">Risk</th>
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
        </section>

        {/* Section 4: Advanced (collapsible) */}
        <section>
          <button
            onClick={() => setAdvancedOpen(!advancedOpen)}
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-300 transition-colors"
          >
            <svg className={clsx('h-4 w-4 transition-transform', advancedOpen && 'rotate-90')} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            Advanced Analytics
          </button>
          {advancedOpen && (
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {[
                { title: 'Risk Score Histogram', desc: 'Distribution of risk scores across all orders' },
                { title: 'Model Confidence Graph', desc: 'Confidence levels over time for ML predictions' },
                { title: 'False Positive Rate', desc: 'Track incorrectly flagged orders over time' },
              ].map((item) => (
                <div key={item.title} className="rounded-xl border border-dashed border-gray-300 dark:border-slate-600 bg-gray-50 dark:bg-slate-800/50 p-6 text-center">
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 dark:bg-slate-700">
                    <svg className="h-5 w-5 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-700 dark:text-slate-300">{item.title}</p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{item.desc}</p>
                  <span className="mt-3 inline-block rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                    Coming Soon
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
