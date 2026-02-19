'use client';

import { useEffect, useState } from 'react';
import { blacklistApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import clsx from 'clsx';

interface BlacklistEntry {
  id: string;
  type: string;
  value: string;
  reason: string;
  expires_at: string | null;
  created_at: string;
}

const TYPES = ['all', 'phone', 'email', 'ip', 'address', 'name'] as const;

const typeColors: Record<string, { bg: string; text: string }> = {
  phone: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-400' },
  email: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-400' },
  ip: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-400' },
  address: { bg: 'bg-gray-100 dark:bg-slate-700', text: 'text-gray-800 dark:text-slate-300' },
  name: { bg: 'bg-teal-100 dark:bg-teal-900/30', text: 'text-teal-800 dark:text-teal-400' },
};

function TypeBadge({ type }: { type: string }) {
  const color = typeColors[type] || { bg: 'bg-gray-100 dark:bg-slate-700', text: 'text-gray-800 dark:text-slate-300' };
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', color.bg, color.text)}>
      {type.toUpperCase()}
    </span>
  );
}

export default function BlacklistPage() {
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all');

  // Add form state
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState('phone');
  const [formValue, setFormValue] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Reason modal
  const [reasonModal, setReasonModal] = useState<{ text: string; value: string } | null>(null);

  const fetchEntries = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, any> = {};
      if (activeTab !== 'all') params.type = activeTab;
      const res = await blacklistApi.list(params);
      setEntries(res.data.blacklist || res.data || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load blacklist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, [activeTab]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formValue.trim()) {
      setFormError('Value is required');
      return;
    }
    setFormLoading(true);
    setFormError(null);
    try {
      const data: any = {
        type: formType,
        value: formValue.trim(),
      };
      if (formReason.trim()) data.reason = formReason.trim();
      if (formExpiry) data.expires_in_days = parseInt(formExpiry);
      await blacklistApi.add(data);
      setFormValue('');
      setFormReason('');
      setFormExpiry('');
      setShowForm(false);
      await fetchEntries();
    } catch (err: any) {
      setFormError(err.response?.data?.message || 'Failed to add entry');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteLoading(true);
    try {
      await blacklistApi.remove(id);
      setDeleteId(null);
      await fetchEntries();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to remove entry');
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Blacklist Management</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Manage blocked phones, emails, IPs, addresses, and names
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add Entry
          </button>
        </div>

        {/* Add Form */}
        {showForm && (
          <Card title="Add New Blacklist Entry">
            <form onSubmit={handleAdd} className="space-y-4">
              {formError && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                  <p className="text-sm text-red-700 dark:text-red-400">{formError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Type</label>
                  <select
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="phone">Phone</option>
                    <option value="email">Email</option>
                    <option value="ip">IP Address</option>
                    <option value="address">Address</option>
                    <option value="name">Name</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Value</label>
                  <input
                    type="text"
                    value={formValue}
                    onChange={(e) => setFormValue(e.target.value)}
                    placeholder={
                      formType === 'phone' ? '+923001234567' :
                      formType === 'email' ? 'fraud@example.com' :
                      formType === 'ip' ? '192.168.1.1' :
                      formType === 'address' ? '123 Fake Street' :
                      'John Doe'
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Reason</label>
                <textarea
                  value={formReason}
                  onChange={(e) => setFormReason(e.target.value)}
                  rows={2}
                  placeholder="Why is this being blacklisted? (optional)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              <div className="max-w-xs">
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                  Expiry (days) <span className="text-gray-400 dark:text-slate-500 font-normal">- optional</span>
                </label>
                <input
                  type="number"
                  value={formExpiry}
                  onChange={(e) => setFormExpiry(e.target.value)}
                  min="1"
                  placeholder="Leave empty for permanent"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setFormError(null); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {formLoading ? 'Adding...' : 'Add to Blacklist'}
                </button>
              </div>
            </form>
          </Card>
        )}

        {/* Type Filter Tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg w-fit">
          {TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={clsx(
                'px-4 py-2 text-sm font-medium rounded-md transition-colors capitalize',
                activeTab === type
                  ? 'bg-white dark:bg-slate-700 text-gray-900 dark:text-slate-100 shadow-sm'
                  : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200'
              )}
            >
              {type}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Table */}
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto" />
                <p className="mt-3 text-sm text-gray-500 dark:text-slate-400">Loading blacklist...</p>
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-gray-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-slate-100 mb-1">No blacklist entries</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                {activeTab !== 'all'
                  ? `No ${activeTab} entries found. Try a different filter.`
                  : 'Click "Add Entry" to blacklist a phone, email, IP, address, or name.'}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700">
                <tr>
                  <th className="px-4 py-3 text-left text-gray-600 dark:text-slate-400 font-medium">Type</th>
                  <th className="px-4 py-3 text-left text-gray-600 dark:text-slate-400 font-medium">Value</th>
                  <th className="px-4 py-3 text-left text-gray-600 dark:text-slate-400 font-medium">Reason</th>
                  <th className="px-4 py-3 text-left text-gray-600 dark:text-slate-400 font-medium">Expires</th>
                  <th className="px-4 py-3 text-left text-gray-600 dark:text-slate-400 font-medium">Added</th>
                  <th className="px-4 py-3 text-right text-gray-600 dark:text-slate-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700/50">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                    <td className="px-4 py-3">
                      <TypeBadge type={entry.type} />
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-gray-900 dark:text-slate-100">{entry.value}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-400 text-xs">
                      {!entry.reason || entry.reason === '-' ? (
                        <span className="text-gray-400 dark:text-slate-500">-</span>
                      ) : entry.reason.length <= 40 ? (
                        entry.reason
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="max-w-[200px] truncate">{entry.reason}</span>
                          <button
                            onClick={() => setReasonModal({ text: entry.reason, value: entry.value })}
                            className="text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                            title="View full reason"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      {entry.expires_at
                        ? new Date(entry.expires_at).toLocaleDateString()
                        : <span className="text-gray-400 dark:text-slate-500">Never</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {deleteId === entry.id ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-gray-500 dark:text-slate-400">Confirm?</span>
                          <button
                            onClick={() => handleDelete(entry.id)}
                            disabled={deleteLoading}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                          >
                            {deleteLoading ? '...' : 'Yes'}
                          </button>
                          <button
                            onClick={() => setDeleteId(null)}
                            className="px-2 py-1 text-xs bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300 rounded hover:bg-gray-200 dark:hover:bg-slate-600"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteId(entry.id)}
                          className="px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Reason Detail Modal */}
      <Modal
        open={!!reasonModal}
        onClose={() => setReasonModal(null)}
        title={`Blacklist Reason - ${reasonModal?.value || ''}`}
        size="md"
      >
        <p className="text-sm text-gray-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
          {reasonModal?.text}
        </p>
      </Modal>
    </DashboardLayout>
  );
}
