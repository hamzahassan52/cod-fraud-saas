'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/dashboard-layout';
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
  {
    name: 'Free',
    price: 0,
    orders: '500',
    unit: '/mo',
    color: 'gray',
    features: ['Basic fraud detection', 'Email support', '1 store', 'API access'],
    popular: false,
  },
  {
    name: 'Starter',
    price: 49,
    orders: '5,000',
    unit: '/mo',
    color: 'blue',
    features: ['Advanced rules engine', 'Priority support', '3 stores', 'Webhook integration', 'Analytics dashboard'],
    popular: false,
  },
  {
    name: 'Growth',
    price: 149,
    orders: '25,000',
    unit: '/mo',
    color: 'purple',
    features: ['ML-powered scoring', 'Custom rule builder', '10 stores', 'Full analytics suite', 'Override tracking'],
    popular: true,
  },
  {
    name: 'Enterprise',
    price: 499,
    orders: 'Unlimited',
    unit: '',
    color: 'amber',
    features: ['Dedicated support', 'Custom ML models', 'Unlimited stores', 'SLA guarantee', 'SSO + SAML'],
    popular: false,
  },
];

const planColorMap: Record<string, { ring: string; bg: string; badge: string; btn: string; price: string }> = {
  gray:   { ring: 'ring-gray-200 dark:ring-slate-600',   bg: 'bg-gray-50 dark:bg-slate-800',          badge: 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300',      btn: 'bg-gray-800 hover:bg-gray-900 dark:bg-slate-600 dark:hover:bg-slate-500',   price: 'text-gray-900 dark:text-slate-100' },
  blue:   { ring: 'ring-blue-500 dark:ring-blue-500',    bg: 'bg-blue-50/50 dark:bg-blue-900/10',      badge: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',       btn: 'bg-blue-600 hover:bg-blue-700',                                             price: 'text-blue-700 dark:text-blue-400' },
  purple: { ring: 'ring-purple-500 dark:ring-purple-500',bg: 'bg-purple-50/50 dark:bg-purple-900/10',  badge: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400',btn: 'bg-purple-600 hover:bg-purple-700',                                          price: 'text-purple-700 dark:text-purple-400' },
  amber:  { ring: 'ring-amber-500 dark:ring-amber-500',  bg: 'bg-amber-50/30 dark:bg-amber-900/10',    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',   btn: 'bg-amber-600 hover:bg-amber-700',                                           price: 'text-amber-700 dark:text-amber-400' },
};

const mockInvoices = [
  { id: 'INV-2026-003', date: '2026-02-01', amount: 149, status: 'paid', plan: 'Growth' },
  { id: 'INV-2026-002', date: '2026-01-01', amount: 149, status: 'paid', plan: 'Growth' },
  { id: 'INV-2025-012', date: '2025-12-01', amount: 49,  status: 'paid', plan: 'Starter' },
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
        const token = localStorage.getItem('token');
        if (token) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            setPlanInfo({ plan: payload.plan || 'free', usage: 0, limit: 500, billing_cycle_start: new Date().toISOString(), billing_cycle_end: new Date(Date.now() + 30 * 86400000).toISOString() });
          } catch { /* ignore */ }
        }
      } finally {
        setLoading(false);
      }
    };
    fetchPlan();
  }, []);

  const currentPlan = planInfo?.plan?.toLowerCase() || 'free';
  const usagePercent = planInfo ? Math.min((planInfo.usage / planInfo.limit) * 100, 100) : 0;
  const currentPlanData = plans.find(p => p.name.toLowerCase() === currentPlan);
  const colors = planColorMap[currentPlanData?.color || 'gray'];

  const daysLeft = planInfo?.billing_cycle_end
    ? Math.max(0, Math.ceil((new Date(planInfo.billing_cycle_end).getTime() - Date.now()) / 86400000))
    : 0;

  return (
    <DashboardLayout>
      <div className="space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Billing & Plans</h1>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-slate-400">Manage your subscription and usage</p>
        </div>

        {/* Current Plan Card */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
          </div>
        ) : (
          <div className={clsx('rounded-2xl border-2 p-6 sm:p-8', colors.ring, colors.bg)}>
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className={clsx('inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide', colors.badge)}>
                    {currentPlan} plan
                  </span>
                  <span className="text-xs text-gray-500 dark:text-slate-400">{daysLeft}d remaining</span>
                </div>
                <h2 className={clsx('text-4xl font-bold capitalize', colors.price)}>
                  {currentPlan}
                </h2>
                <p className="text-sm text-gray-500 dark:text-slate-400">
                  {planInfo?.billing_cycle_start
                    ? `${new Date(planInfo.billing_cycle_start).toLocaleDateString('en-PK', { month: 'long', day: 'numeric' })} — ${new Date(planInfo.billing_cycle_end).toLocaleDateString('en-PK', { month: 'long', day: 'numeric', year: 'numeric' })}`
                    : 'Active subscription'}
                </p>
              </div>

              <div className="sm:text-right">
                <p className="text-4xl font-bold text-gray-900 dark:text-slate-100">
                  ${currentPlanData?.price ?? 0}
                  <span className="text-base font-normal text-gray-500 dark:text-slate-400">/mo</span>
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{currentPlanData?.orders} orders{currentPlanData?.unit}</p>
              </div>
            </div>

            {/* Usage bar */}
            <div className="mt-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-slate-300">Order usage this cycle</span>
                <span className={clsx('text-sm font-bold', usagePercent >= 90 ? 'text-red-600 dark:text-red-400' : usagePercent >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-slate-100')}>
                  {(planInfo?.usage || 0).toLocaleString()} / {(planInfo?.limit || 500).toLocaleString()}
                </span>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-white/60 dark:bg-slate-700">
                <div
                  className={clsx('h-3 rounded-full transition-all duration-700', usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-blue-500')}
                  style={{ width: `${usagePercent || 0}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-slate-400">{usagePercent.toFixed(0)}% used</p>
            </div>
          </div>
        )}

        {/* Plans Grid */}
        <div>
          <h2 className="mb-5 text-lg font-semibold text-gray-900 dark:text-slate-100">Available Plans</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((plan) => {
              const isCurrent = plan.name.toLowerCase() === currentPlan;
              const c = planColorMap[plan.color];
              return (
                <div
                  key={plan.name}
                  className={clsx(
                    'relative flex flex-col rounded-2xl border-2 p-6 transition-all',
                    isCurrent
                      ? clsx(c.ring, c.bg, 'shadow-lg')
                      : 'border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800 hover:border-gray-300 dark:hover:border-slate-600'
                  )}
                >
                  {plan.popular && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-purple-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                        Most Popular
                      </span>
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="rounded-full bg-blue-600 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm">
                        Current Plan
                      </span>
                    </div>
                  )}

                  <div className="mb-4">
                    <h3 className="text-base font-bold text-gray-900 dark:text-slate-100">{plan.name}</h3>
                    <div className="mt-3 flex items-end gap-1">
                      <span className={clsx('text-4xl font-extrabold', isCurrent ? c.price : 'text-gray-900 dark:text-slate-100')}>
                        ${plan.price}
                      </span>
                      <span className="mb-1.5 text-sm text-gray-500 dark:text-slate-400">/mo</span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-gray-500 dark:text-slate-400">
                      {plan.orders}{plan.unit} orders
                    </p>
                  </div>

                  <ul className="mb-6 flex-1 space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-slate-400">
                        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    disabled={isCurrent}
                    className={clsx(
                      'w-full rounded-xl py-2.5 text-sm font-semibold transition-all',
                      isCurrent
                        ? clsx(c.btn, 'cursor-default text-white opacity-80')
                        : 'border-2 border-gray-200 bg-transparent text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-700'
                    )}
                  >
                    {isCurrent ? '✓ Active' : 'Upgrade'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Invoice History */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-gray-900 dark:text-slate-100">Invoice History</h2>
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/60">
                    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Invoice</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Plan</th>
                    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Date</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Amount</th>
                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/60">
                  {mockInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-gray-50/50 dark:hover:bg-slate-700/20 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900 dark:text-slate-200">{inv.id}</td>
                      <td className="px-6 py-4 text-gray-500 dark:text-slate-400">{inv.plan}</td>
                      <td className="px-6 py-4 text-gray-500 dark:text-slate-400">
                        {new Date(inv.date).toLocaleDateString('en-PK', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-gray-900 dark:text-slate-200">${inv.amount}</td>
                      <td className="px-6 py-4 text-right">
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          Paid
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
