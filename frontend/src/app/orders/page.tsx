'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ordersApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import clsx from 'clsx';

interface Order {
  id: string;
  external_order_id: string;
  platform: string;
  customer_name: string;
  customer_phone: string;
  shipping_city: string;
  total_amount: number;
  risk_score: number;
  risk_level: string;
  recommendation: string;
  risk_summary: string;
  status: string;
  created_at: string;
}

const recColors: Record<string, string> = {
  APPROVE: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  VERIFY: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  BLOCK: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

function OrdersContent() {
  const searchParams = useSearchParams();
  const [orders, setOrders] = useState<Order[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [filters, setFilters] = useState({
    recommendation: searchParams.get('recommendation') || '',
    search: '',
    status: '',
    risk_level: '',
  });
  const [loading, setLoading] = useState(true);

  const fetchOrders = async (page = 1) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, limit: 20 };
      if (filters.recommendation) params.recommendation = filters.recommendation;
      if (filters.search) params.search = filters.search;
      if (filters.status) params.status = filters.status;
      if (filters.risk_level) params.risk_level = filters.risk_level;
      const res = await ordersApi.list(params);
      setOrders(res.data.orders || []);
      setPagination(res.data.pagination || { page: 1, total: 0, totalPages: 0 });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [filters]);

  const handleOverride = async (orderId: string, rec: string) => {
    if (!confirm(`Override to ${rec}?`)) return;
    try {
      await ordersApi.override(orderId, rec);
      fetchOrders(pagination.page);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Orders</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Monitor and manage all incoming orders</p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <input
            type="text"
            placeholder="Search phone, name, order ID..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="max-w-xs flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:placeholder-slate-500"
          />
          <select
            value={filters.risk_level}
            onChange={(e) => setFilters({ ...filters, risk_level: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">All Risk Levels</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
          <select
            value={filters.recommendation}
            onChange={(e) => setFilters({ ...filters, recommendation: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">All Decisions</option>
            <option value="APPROVE">Approved</option>
            <option value="VERIFY">Suspicious</option>
            <option value="BLOCK">Blocked</option>
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="">All Status</option>
            <option value="scored">Scored</option>
            <option value="delivered">Delivered</option>
            <option value="rto">RTO</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 dark:border-slate-700 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Order</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Customer</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">City</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Risk Score</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                {orders.map((order) => (
                  <tr key={order.id} className="transition-colors hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3">
                      <Link href={`/orders/${order.id}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                        {order.external_order_id}
                      </Link>
                      <div className="text-xs capitalize text-gray-500 dark:text-slate-500">{order.platform}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900 dark:text-slate-200">{order.customer_name}</div>
                      <div className="text-xs text-gray-500 dark:text-slate-500">{order.customer_phone}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-300">{order.shipping_city}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-200">PKR {order.total_amount?.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'text-lg font-bold',
                        (order.risk_score || 0) >= 70 ? 'text-red-600 dark:text-red-400' :
                        (order.risk_score || 0) >= 40 ? 'text-amber-600 dark:text-amber-400' :
                        'text-green-600 dark:text-green-400'
                      )}>
                        {order.risk_score ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', recColors[order.recommendation] || 'bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-300')}>
                        {order.recommendation || 'PENDING'}
                      </span>
                      {order.risk_summary && (
                        <div className="text-xs text-gray-500 dark:text-slate-500 mt-1 max-w-[200px] truncate" title={order.risk_summary}>
                          {order.risk_summary}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {order.recommendation !== 'APPROVE' && (
                          <button onClick={() => handleOverride(order.id, 'APPROVE')} className="rounded px-2 py-1 text-xs text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20">
                            Approve
                          </button>
                        )}
                        {order.recommendation !== 'BLOCK' && (
                          <button onClick={() => handleOverride(order.id, 'BLOCK')} className="rounded px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">
                            Block
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {orders.length === 0 && !loading && (
            <div className="p-8 text-center text-gray-500 dark:text-slate-400">No orders found</div>
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => fetchOrders(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Previous
            </button>
            <span className="text-sm text-gray-500 dark:text-slate-400">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              onClick={() => fetchOrders(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={
      <DashboardLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
        </div>
      </DashboardLayout>
    }>
      <OrdersContent />
    </Suspense>
  );
}
