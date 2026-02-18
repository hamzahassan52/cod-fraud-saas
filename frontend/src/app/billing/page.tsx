'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import api from '@/lib/api';
import clsx from 'clsx';

interface PlanInfo {
  plan: string;
  usage: number;
  limit: number;
  billing_cycle_start: string;
  billing_cycle_end: string;
}

const plans = [
  { name: 'Free', price: 0, orders: '500/mo', features: ['Basic fraud detection', 'Email support', '1 store'] },
  { name: 'Starter', price: 49, orders: '5,000/mo', features: ['Advanced rules', 'Priority support', '3 stores', 'API access'] },
  { name: 'Growth', price: 149, orders: '25,000/mo', features: ['ML scoring', 'Custom rules', '10 stores', 'Webhooks', 'Analytics'] },
  { name: 'Enterprise', price: 499, orders: 'Unlimited', features: ['Dedicated support', 'Custom ML models', 'Unlimited stores', 'SLA', 'SSO'] },
];

const mockInvoices = [
  { id: 'INV-001', date: '2026-02-01', amount: 149, status: 'paid' },
  { id: 'INV-002', date: '2026-01-01', amount: 149, status: 'paid' },
  { id: 'INV-003', date: '2025-12-01', amount: 49, status: 'paid' },
];

export default function BillingPage() {
  const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const res = await api.get('/auth/plan');
        setPlanInfo(res.data.plan || res.data);
      } catch {
        // Use fallback from JWT
        const token = localStorage.getItem('token');
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setPlanInfo({
              plan: payload.plan || 'free',
              usage: 0,
              limit: 500,
              billing_cycle_start: new Date().toISOString(),
              billing_cycle_end: new Date(Date.now() + 30 * 86400000).toISOString(),
            });
          } catch { /* ignore */ }
        }
      } finally {
        setLoading(false);
      }
    };
    fetchPlan();
  }, []);

  const currentPlan = planInfo?.plan || 'free';
  const usagePercent = planInfo ? Math.min((planInfo.usage / planInfo.limit) * 100, 100) : 0;

  return (
    <DashboardLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Billing</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Manage your plan and billing</p>
        </div>

        {/* Current Plan */}
        <Card title="Current Plan">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-bold capitalize text-gray-900 dark:text-slate-100">{currentPlan} Plan</h3>
                  <Badge variant={currentPlan === 'enterprise' ? 'info' : currentPlan === 'growth' ? 'success' : currentPlan === 'starter' ? 'warning' : 'neutral'}>
                    {currentPlan.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {planInfo && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-slate-400">
                      {planInfo.usage.toLocaleString()} / {planInfo.limit.toLocaleString()} orders
                    </span>
                    <span className={clsx('text-sm font-semibold', usagePercent >= 90 ? 'text-red-600 dark:text-red-400' : usagePercent >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-slate-100')}>
                      {usagePercent.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-slate-700">
                    <div
                      className={clsx('h-3 rounded-full transition-all duration-500', usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-blue-500')}
                      style={{ width: `${usagePercent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-gray-400 dark:text-slate-500">
                    Billing period: {planInfo.billing_cycle_start ? new Date(planInfo.billing_cycle_start).toLocaleDateString() : 'N/A'} - {planInfo.billing_cycle_end ? new Date(planInfo.billing_cycle_end).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Plans Grid */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">Available Plans</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = plan.name.toLowerCase() === currentPlan;
              return (
                <div
                  key={plan.name}
                  className={clsx(
                    'rounded-xl border p-5',
                    isCurrent
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                      : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                  )}
                >
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{plan.name}</h3>
                  <div className="mt-2">
                    <span className="text-3xl font-bold text-gray-900 dark:text-slate-100">${plan.price}</span>
                    <span className="text-sm text-gray-500 dark:text-slate-400">/mo</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{plan.orders} orders</p>
                  <ul className="mt-4 space-y-2">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                        <svg className="h-3.5 w-3.5 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button
                    className={clsx(
                      'mt-4 w-full rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                      isCurrent
                        ? 'cursor-default bg-blue-600 text-white'
                        : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
                    )}
                    disabled={isCurrent}
                  >
                    {isCurrent ? 'Current Plan' : 'Upgrade'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Invoice History */}
        <Card title="Invoice History">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-slate-700">
                  <th className="py-2 text-left text-gray-500 dark:text-slate-400">Invoice</th>
                  <th className="py-2 text-left text-gray-500 dark:text-slate-400">Date</th>
                  <th className="py-2 text-right text-gray-500 dark:text-slate-400">Amount</th>
                  <th className="py-2 text-right text-gray-500 dark:text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {mockInvoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-50 dark:border-slate-700/50">
                    <td className="py-2.5 font-medium text-gray-900 dark:text-slate-200">{inv.id}</td>
                    <td className="py-2.5 text-gray-500 dark:text-slate-400">{new Date(inv.date).toLocaleDateString()}</td>
                    <td className="py-2.5 text-right font-medium text-gray-900 dark:text-slate-200">${inv.amount}</td>
                    <td className="py-2.5 text-right">
                      <Badge variant="success">Paid</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
