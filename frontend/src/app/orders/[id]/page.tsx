'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ordersApi, analyticsApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import clsx from 'clsx';

interface FraudSignal {
  signal: string;
  score: number;
  layer: string;
  description: string;
}

interface LineItem {
  name: string;
  quantity: number;
  price: number;
  sku?: string;
}

interface Order {
  id: string;
  external_order_id: string;
  platform: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  phone_normalized: string;
  phone_carrier: string;
  shipping_address: any;
  shipping_city: string;
  shipping_state: string;
  total_amount: number;
  currency: string;
  items_count: number;
  line_items: LineItem[];
  risk_score: number;
  risk_level: string;
  recommendation: string;
  fraud_signals: FraudSignal[];
  recommendation_reasons: string[];
  risk_summary: string;
  status: string;
  is_repeat_customer: boolean;
  previous_order_count: number;
  previous_rto_count: number;
  created_at: string;
  scored_at: string;
  rule_score: number;
  statistical_score: number;
  ml_score: number;
  confidence: number;
  ml_model_version: string;
  scoring_duration_ms: number;
  override_recommendation: string | null;
  override_reason: string | null;
  override_by: string | null;
  override_at: string | null;
  // Dispatch & delivery
  tracking_number: string | null;
  final_status: string;
  call_confirmed: string | null;
  dispatched_at: string | null;
  returned_at: string | null;
}

function RiskBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    LOW: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    MEDIUM: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    HIGH: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    CRITICAL: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', colors[level] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300')}>
      {level}
    </span>
  );
}

function RecommendationBadge({ recommendation }: { recommendation: string }) {
  const colors: Record<string, string> = {
    APPROVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    VERIFY: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    BLOCK: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', colors[recommendation] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300')}>
      {recommendation || 'PENDING'}
    </span>
  );
}

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">{label}</span>
        <span className="text-sm font-bold text-gray-900 dark:text-slate-100">{score?.toFixed(1) ?? 'N/A'} / 100</span>
      </div>
      <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-3">
        <div
          className={clsx('h-3 rounded-full transition-all duration-500', color)}
          style={{ width: `${Math.min(Math.max(score || 0, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Override modal
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideAction, setOverrideAction] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  // Dispatch modal
  const [showDispatchModal, setShowDispatchModal] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [dispatchLoading, setDispatchLoading] = useState(false);

  // Call outcome
  const [callLoading, setCallLoading] = useState(false);

  // Feedback
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);

  const fetchOrder = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ordersApi.get(orderId);
      const data = res.data.order || res.data;
      // Parse JSON fields if they are strings
      if (typeof data.fraud_signals === 'string') {
        try { data.fraud_signals = JSON.parse(data.fraud_signals); } catch { data.fraud_signals = []; }
      }
      if (typeof data.line_items === 'string') {
        try { data.line_items = JSON.parse(data.line_items); } catch { data.line_items = []; }
      }
      if (typeof data.shipping_address === 'string') {
        try { data.shipping_address = JSON.parse(data.shipping_address); } catch { data.shipping_address = {}; }
      }
      if (typeof data.recommendation_reasons === 'string') {
        try { data.recommendation_reasons = JSON.parse(data.recommendation_reasons); } catch { data.recommendation_reasons = []; }
      }
      setOrder(data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) fetchOrder();
  }, [orderId]);

  const handleOverride = async () => {
    if (!overrideAction) return;
    setOverrideLoading(true);
    try {
      await ordersApi.override(orderId, overrideAction, overrideReason || undefined);
      setShowOverrideModal(false);
      setOverrideAction('');
      setOverrideReason('');
      await fetchOrder();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Override failed');
    } finally {
      setOverrideLoading(false);
    }
  };

  const handleFeedback = async (outcome: string) => {
    setFeedbackLoading(true);
    setFeedbackSuccess(null);
    try {
      await analyticsApi.submitFeedback({ orderId, outcome });
      setFeedbackSuccess(`Order marked as ${outcome}`);
      await fetchOrder();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Feedback submission failed');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleDispatch = async () => {
    if (!trackingNumber.trim()) return;
    setDispatchLoading(true);
    try {
      await ordersApi.dispatch(orderId, trackingNumber.trim().toUpperCase());
      setShowDispatchModal(false);
      setTrackingNumber('');
      await fetchOrder();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Dispatch failed');
    } finally {
      setDispatchLoading(false);
    }
  };

  const handleCallOutcome = async (confirmed: string) => {
    setCallLoading(true);
    try {
      await ordersApi.callOutcome(orderId, confirmed);
      await fetchOrder();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save call outcome');
    } finally {
      setCallLoading(false);
    }
  };

  const openOverride = (action: string) => {
    setOverrideAction(action);
    setOverrideReason('');
    setShowOverrideModal(true);
  };

  // Group fraud signals by layer
  const groupedSignals: Record<string, FraudSignal[]> = {};
  if (order?.fraud_signals && Array.isArray(order.fraud_signals)) {
    order.fraud_signals.forEach((s) => {
      const layer = s.layer || 'other';
      if (!groupedSignals[layer]) groupedSignals[layer] = [];
      groupedSignals[layer].push(s);
    });
  }

  const layerOrder = ['rule', 'statistical', 'ml', 'other'];

  const getRiskScoreColor = (score: number) => {
    if (score >= 70) return 'text-red-600 dark:text-red-400';
    if (score >= 40) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-green-600 dark:text-green-400';
  };

  const formatAddress = (addr: any) => {
    if (!addr) return 'N/A';
    if (typeof addr === 'string') return addr;
    const parts = [addr.address1, addr.address2, addr.city, addr.province, addr.zip, addr.country].filter(Boolean);
    return parts.join(', ') || 'N/A';
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
            <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">Loading order details...</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (error || !order) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">Order Not Found</h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">{error || 'The requested order could not be loaded.'}</p>
            <Link href="/orders" className="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">
              Back to Orders
            </Link>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <Link href="/orders" className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 mb-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Orders
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">
              Order {order.external_order_id}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-sm text-gray-500 dark:text-slate-400 capitalize">{order.platform}</span>
              <span className="text-sm text-gray-500 dark:text-slate-400">|</span>
              <span className="text-sm text-gray-500 dark:text-slate-400">
                {new Date(order.created_at).toLocaleString()}
              </span>
              <Badge variant={order.status === 'delivered' ? 'success' : order.status === 'rto' ? 'danger' : 'neutral'}>
                {order.status?.toUpperCase() || 'PENDING'}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Dispatch button — only if not already dispatched/delivered/returned */}
            {!['dispatched', 'delivered', 'returned'].includes(order.final_status) && (
              <button
                onClick={() => setShowDispatchModal(true)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
              >
                Dispatch
              </button>
            )}
            {order.final_status === 'dispatched' && (
              <span className="px-3 py-2 bg-blue-500/20 text-blue-300 text-sm font-medium rounded-lg border border-blue-500/30">
                In Transit
              </span>
            )}
            {order.final_status === 'delivered' && (
              <span className="px-3 py-2 bg-green-500/20 text-green-300 text-sm font-medium rounded-lg border border-green-500/30">
                Delivered
              </span>
            )}
            {order.final_status === 'returned' && (
              <span className="px-3 py-2 bg-red-500/20 text-red-300 text-sm font-medium rounded-lg border border-red-500/30">
                Returned
              </span>
            )}
            <button
              onClick={() => openOverride('APPROVE')}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Approve
            </button>
            <button
              onClick={() => openOverride('VERIFY')}
              className="px-4 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 transition-colors"
            >
              Verify
            </button>
            <button
              onClick={() => openOverride('BLOCK')}
              className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors"
            >
              Block
            </button>
          </div>
        </div>

        {/* Score Hero */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
            {/* Final Score */}
            <div className="text-center">
              <p className="text-sm text-gray-500 dark:text-slate-400 mb-2">Final Risk Score</p>
              <p className={clsx('text-5xl font-bold', getRiskScoreColor(order.risk_score))}>
                {order.risk_score ?? '--'}
              </p>
              <div className="flex items-center justify-center gap-2 mt-3">
                <RiskBadge level={order.risk_level} />
                <RecommendationBadge recommendation={order.recommendation} />
              </div>
            </div>

            {/* Layer Scores */}
            <div className="md:col-span-2 space-y-4">
              <ScoreBar label="Rule Engine" score={order.rule_score} color="bg-blue-500" />
              <ScoreBar label="Statistical Analysis" score={order.statistical_score} color="bg-purple-500" />
              <ScoreBar label="ML Model" score={order.ml_score} color="bg-indigo-500" />
            </div>

            {/* Metadata */}
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Confidence</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2">
                    <div
                      className="h-2 rounded-full bg-emerald-500"
                      style={{ width: `${(order.confidence || 0) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold text-gray-800 dark:text-slate-200">
                    {((order.confidence || 0) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Model Version</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">{order.ml_model_version || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Scoring Duration</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">{order.scoring_duration_ms ?? '--'} ms</p>
              </div>
              {order.scored_at && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Scored At</p>
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">
                    {new Date(order.scored_at).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Decision Reasons */}
        {order.recommendation_reasons && order.recommendation_reasons.length > 0 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className={clsx(
                'w-8 h-8 rounded-full flex items-center justify-center',
                order.recommendation === 'APPROVE' ? 'bg-green-100 dark:bg-green-900/30' :
                order.recommendation === 'VERIFY' ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                'bg-red-100 dark:bg-red-900/30'
              )}>
                <svg className={clsx(
                  'w-4 h-4',
                  order.recommendation === 'APPROVE' ? 'text-green-600 dark:text-green-400' :
                  order.recommendation === 'VERIFY' ? 'text-yellow-600 dark:text-yellow-400' :
                  'text-red-600 dark:text-red-400'
                )} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Decision Reasons</h3>
                {order.risk_summary && (
                  <p className={clsx(
                    'text-xs mt-0.5',
                    order.recommendation === 'APPROVE' ? 'text-green-600 dark:text-green-400' :
                    order.recommendation === 'VERIFY' ? 'text-yellow-600 dark:text-yellow-400' :
                    'text-red-600 dark:text-red-400'
                  )}>
                    {order.risk_summary}
                  </p>
                )}
              </div>
            </div>
            <ul className="space-y-2">
              {order.recommendation_reasons.map((reason, idx) => {
                const isPositive = reason.startsWith('[Positive]') || order.recommendation === 'APPROVE';
                const isRisk = !isPositive && (order.recommendation === 'BLOCK' || order.recommendation === 'VERIFY');
                const displayReason = reason.replace('[Positive] ', '');
                return (
                  <li key={idx} className="flex items-start gap-2">
                    <span className={clsx(
                      'mt-1.5 w-2 h-2 rounded-full flex-shrink-0',
                      reason.startsWith('[Positive]') ? 'bg-green-500' :
                      order.recommendation === 'APPROVE' ? 'bg-green-500' :
                      order.recommendation === 'VERIFY' ? 'bg-amber-500' :
                      'bg-red-500'
                    )} />
                    <span className={clsx(
                      'text-sm',
                      reason.startsWith('[Positive]') ? 'text-green-700 dark:text-green-400' :
                      order.recommendation === 'APPROVE' ? 'text-green-700 dark:text-green-400' :
                      order.recommendation === 'VERIFY' ? 'text-amber-700 dark:text-amber-400' :
                      'text-red-700 dark:text-red-400'
                    )}>
                      {displayReason}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* Override History */}
        {order.override_at && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Manual Override Applied</h3>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  This order's recommendation was manually overridden
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wide">Overridden To</p>
                <RecommendationBadge recommendation={order.override_recommendation || ''} />
              </div>
              <div>
                <p className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wide">When</p>
                <p className="text-sm font-medium text-amber-900 dark:text-amber-200 mt-0.5">
                  {new Date(order.override_at).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-amber-700 dark:text-amber-400 uppercase tracking-wide">Reason</p>
                <p className="text-sm text-amber-900 dark:text-amber-200 mt-0.5">
                  {order.override_reason || 'No reason provided'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Customer Details */}
          <Card title="Customer Details">
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Name</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{order.customer_name || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Email</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{order.customer_email || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Phone</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{order.customer_phone || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Normalized Phone</p>
                <p className="text-sm font-mono text-gray-900 dark:text-slate-100">{order.phone_normalized || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Carrier</p>
                {order.phone_carrier ? (
                  <Badge variant="info">{order.phone_carrier}</Badge>
                ) : (
                  <span className="text-sm text-gray-500 dark:text-slate-400">Unknown</span>
                )}
              </div>
            </div>
          </Card>

          {/* Shipping Address */}
          <Card title="Shipping Address">
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Full Address</p>
                <p className="text-sm text-gray-900 dark:text-slate-100">{formatAddress(order.shipping_address)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">City</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{order.shipping_city || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">State / Province</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{order.shipping_state || 'N/A'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Order Amount</p>
                <p className="text-lg font-bold text-gray-900 dark:text-slate-100">
                  {order.currency || 'PKR'} {order.total_amount?.toLocaleString() ?? '0'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Items</p>
                <p className="text-sm text-gray-900 dark:text-slate-100">{order.items_count ?? 0} item(s)</p>
              </div>
            </div>
          </Card>

          {/* Customer History */}
          <Card title="Customer History">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={clsx(
                  'w-10 h-10 rounded-full flex items-center justify-center',
                  order.is_repeat_customer ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-slate-700'
                )}>
                  <svg className={clsx('w-5 h-5', order.is_repeat_customer ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-slate-400')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-slate-100">
                    {order.is_repeat_customer ? 'Repeat Customer' : 'New Customer'}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    {order.is_repeat_customer ? 'Has ordered before' : 'First order'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{order.previous_order_count ?? 0}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Previous Orders</p>
                </div>
                <div className="bg-gray-50 dark:bg-slate-700 rounded-lg p-3 text-center">
                  <p className={clsx(
                    'text-2xl font-bold',
                    (order.previous_rto_count || 0) > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-slate-100'
                  )}>
                    {order.previous_rto_count ?? 0}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Previous RTOs</p>
                </div>
              </div>

              {(order.previous_order_count || 0) > 0 && (order.previous_rto_count || 0) > 0 && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                  <p className="text-xs font-medium text-yellow-800 dark:text-yellow-400">
                    RTO Rate: {((order.previous_rto_count / order.previous_order_count) * 100).toFixed(0)}%
                  </p>
                </div>
              )}

              {/* RTO Feedback Section */}
              <div className="border-t border-gray-100 dark:border-slate-700 pt-4 mt-4">
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide mb-3">RTO Feedback</p>
                {feedbackSuccess && (
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-2 mb-3">
                    <p className="text-xs text-green-700 dark:text-green-400">{feedbackSuccess}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleFeedback('delivered')}
                    disabled={feedbackLoading || order.status === 'delivered'}
                    className={clsx(
                      'flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors',
                      order.status === 'delivered'
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 cursor-not-allowed'
                        : 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30'
                    )}
                  >
                    {feedbackLoading ? '...' : 'Delivered'}
                  </button>
                  <button
                    onClick={() => handleFeedback('rto')}
                    disabled={feedbackLoading || order.status === 'rto'}
                    className={clsx(
                      'flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors',
                      order.status === 'rto'
                        ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 cursor-not-allowed'
                        : 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30'
                    )}
                  >
                    {feedbackLoading ? '...' : 'RTO'}
                  </button>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Line Items */}
        {order.line_items && order.line_items.length > 0 && (
          <Card title="Line Items">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Item</th>
                    <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">SKU</th>
                    <th className="text-right py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Qty</th>
                    <th className="text-right py-2 text-gray-500 dark:text-slate-400 font-medium">Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {order.line_items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 pr-4 font-medium text-gray-900 dark:text-slate-100">{item.name}</td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-slate-400 font-mono text-xs">{item.sku || '-'}</td>
                      <td className="py-2.5 pr-4 text-right text-gray-700 dark:text-slate-300">{item.quantity}</td>
                      <td className="py-2.5 text-right font-medium text-gray-900 dark:text-slate-100">
                        {order.currency || 'PKR'} {item.price?.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Fraud Signals */}
        <Card title="Fraud Signals" subtitle={`${order.fraud_signals?.length || 0} signals detected across all layers`}>
          {(!order.fraud_signals || order.fraud_signals.length === 0) ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-gray-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500 dark:text-slate-400">No fraud signals detected</p>
            </div>
          ) : (
            <div className="space-y-6">
              {layerOrder.map((layer) => {
                const signals = groupedSignals[layer];
                if (!signals || signals.length === 0) return null;

                const layerLabels: Record<string, { label: string; color: string }> = {
                  rule: { label: 'Rule Engine', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' },
                  statistical: { label: 'Statistical Analysis', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' },
                  ml: { label: 'ML Model', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400' },
                  other: { label: 'Other', color: 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300' },
                };

                const meta = layerLabels[layer] || layerLabels.other;

                return (
                  <div key={layer}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', meta.color)}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-slate-400">{signals.length} signal(s)</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-slate-700">
                            <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Signal</th>
                            <th className="text-right py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium w-24">Score</th>
                            <th className="text-left py-2 text-gray-500 dark:text-slate-400 font-medium">Description</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                          {signals.map((signal, idx) => (
                            <tr key={idx}>
                              <td className="py-2.5 pr-4">
                                <span className="font-mono text-xs bg-gray-50 dark:bg-slate-700 px-2 py-1 rounded text-gray-800 dark:text-slate-300">
                                  {signal.signal}
                                </span>
                              </td>
                              <td className="py-2.5 pr-4 text-right">
                                <span className={clsx(
                                  'font-bold text-sm',
                                  signal.score > 0 ? 'text-red-600 dark:text-red-400' : signal.score < 0 ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-slate-400'
                                )}>
                                  {signal.score > 0 ? '+' : ''}{signal.score}
                                </span>
                              </td>
                              <td className="py-2.5 text-gray-600 dark:text-slate-400 text-xs">{signal.description}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowOverrideModal(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              Override to {overrideAction}
            </h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              This will override the automated recommendation for order {order.external_order_id}.
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              rows={3}
              placeholder="Why are you overriding this recommendation?"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowOverrideModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleOverride}
                disabled={overrideLoading}
                className={clsx(
                  'px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50',
                  overrideAction === 'APPROVE' ? 'bg-green-600 hover:bg-green-700' :
                  overrideAction === 'VERIFY' ? 'bg-yellow-500 hover:bg-yellow-600' :
                  'bg-red-600 hover:bg-red-700'
                )}
              >
                {overrideLoading ? 'Saving...' : `Confirm ${overrideAction}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Modal */}
      {showDispatchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowDispatchModal(false)} />
          <div className="relative bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
              Dispatch Order
            </h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              Enter the tracking number printed on the parcel label for order {order.external_order_id}.
            </p>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
              Tracking Number
            </label>
            <input
              type="text"
              value={trackingNumber}
              onChange={e => setTrackingNumber(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleDispatch()}
              placeholder="TRK-XXXXXX"
              className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">
              This number will be used by scanner to identify the parcel if it returns.
            </p>
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setShowDispatchModal(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDispatch}
                disabled={dispatchLoading || !trackingNumber.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
              >
                {dispatchLoading ? 'Dispatching...' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Call Outcome Card — shown when order is in VERIFY state */}
      {order.recommendation === 'VERIFY' && !['returned', 'delivered'].includes(order.final_status) && (
        <div className="fixed bottom-6 right-6 z-40 bg-gray-900 border border-yellow-500/40 rounded-xl shadow-2xl p-4 w-80">
          <p className="text-sm font-semibold text-yellow-300 mb-1">Record Call Outcome</p>
          <p className="text-xs text-gray-400 mb-3">
            {order.call_confirmed
              ? `Call recorded: ${order.call_confirmed.toUpperCase()}`
              : 'Did customer confirm on call?'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleCallOutcome('yes')}
              disabled={callLoading || order.call_confirmed === 'yes'}
              className={clsx(
                'flex-1 py-2 text-xs font-semibold rounded-lg transition-colors',
                order.call_confirmed === 'yes'
                  ? 'bg-green-600 text-white cursor-default'
                  : 'bg-green-600/20 text-green-400 hover:bg-green-600/30 border border-green-500/30'
              )}
            >
              YES
            </button>
            <button
              onClick={() => handleCallOutcome('no')}
              disabled={callLoading || order.call_confirmed === 'no'}
              className={clsx(
                'flex-1 py-2 text-xs font-semibold rounded-lg transition-colors',
                order.call_confirmed === 'no'
                  ? 'bg-red-600 text-white cursor-default'
                  : 'bg-red-600/20 text-red-400 hover:bg-red-600/30 border border-red-500/30'
              )}
            >
              NO
            </button>
            <button
              onClick={() => handleCallOutcome('no_answer')}
              disabled={callLoading || order.call_confirmed === 'no_answer'}
              className={clsx(
                'flex-1 py-2 text-xs font-semibold rounded-lg transition-colors',
                order.call_confirmed === 'no_answer'
                  ? 'bg-gray-500 text-white cursor-default'
                  : 'bg-gray-600/20 text-gray-400 hover:bg-gray-600/30 border border-gray-500/30'
              )}
            >
              N/A
            </button>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
