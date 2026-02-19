'use client';

import { useEffect, useState, useRef } from 'react';
import { mlApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import clsx from 'clsx';
import api from '@/lib/api';

interface UserProfile {
  name: string;
  email: string;
  tenant: string;
  tenant_id: string;
}

interface PlanInfo {
  plan: string;
  usage: number;
  limit: number;
  billing_cycle_start: string;
  billing_cycle_end: string;
}

interface ApiKey {
  id: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}

export default function SettingsPage() {
  // Account
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Plan
  const [plan, setPlan] = useState<PlanInfo | null>(null);
  const [planLoading, setPlanLoading] = useState(true);

  // Thresholds
  const [blockThreshold, setBlockThreshold] = useState(70);
  const [verifyThreshold, setVerifyThreshold] = useState(40);
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdSuccess, setThresholdSuccess] = useState(false);
  const [thresholdError, setThresholdError] = useState<string | null>(null);

  // API Keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [keysLoading, setKeysLoading] = useState(true);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  useEffect(() => {
    fetchProfile();
    fetchPlan();
    fetchApiKeys();
    fetchThresholds();
  }, []);

  const fetchProfile = async () => {
    setProfileLoading(true);
    try {
      const res = await api.get('/auth/profile');
      setProfile(res.data.user || res.data);
    } catch {
      // User might not have this endpoint; use fallback
      const token = localStorage.getItem('token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setProfile({
            name: payload.name || 'User',
            email: payload.email || '',
            tenant: payload.tenant_name || payload.tenant || 'Default',
            tenant_id: payload.tenant_id || '',
          });
        } catch {
          setProfile({ name: 'User', email: '', tenant: 'Default', tenant_id: '' });
        }
      }
    } finally {
      setProfileLoading(false);
    }
  };

  const fetchPlan = async () => {
    setPlanLoading(true);
    try {
      const res = await api.get('/auth/plan');
      setPlan(res.data.plan || res.data);
    } catch {
      // Fallback
      setPlan(null);
    } finally {
      setPlanLoading(false);
    }
  };

  const fetchThresholds = async () => {
    try {
      const res = await api.get('/settings/thresholds');
      const data = res.data;
      if (data.block_threshold !== undefined) setBlockThreshold(data.block_threshold);
      if (data.verify_threshold !== undefined) setVerifyThreshold(data.verify_threshold);
    } catch {
      // Use defaults
    }
  };

  const fetchApiKeys = async () => {
    setKeysLoading(true);
    try {
      const res = await api.get('/auth/api-keys');
      setApiKeys(res.data.keys || res.data || []);
    } catch {
      setApiKeys([]);
    } finally {
      setKeysLoading(false);
    }
  };

  const saveThresholds = async () => {
    if (verifyThreshold >= blockThreshold) {
      setThresholdError('Verify threshold must be lower than block threshold');
      return;
    }
    setThresholdSaving(true);
    setThresholdError(null);
    setThresholdSuccess(false);
    try {
      await mlApi.threshold({
        block_threshold: blockThreshold,
        verify_threshold: verifyThreshold,
      });
      setThresholdSuccess(true);
      setTimeout(() => setThresholdSuccess(false), 3000);
    } catch (err: any) {
      setThresholdError(err.response?.data?.message || 'Failed to save thresholds');
    } finally {
      setThresholdSaving(false);
    }
  };

  const generateApiKey = async () => {
    setGeneratingKey(true);
    setNewKey(null);
    try {
      const res = await api.post('/auth/api-keys');
      const key = res.data.key || res.data.api_key;
      setNewKey(key);
      await fetchApiKeys();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to generate API key');
    } finally {
      setGeneratingKey(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  const usagePercent = plan ? Math.min((plan.usage / plan.limit) * 100, 100) : 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Manage your account, plan, thresholds, and API keys</p>
        </div>

        {/* Account Info */}
        <Card title="Account Information">
          {profileLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : profile ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Name</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">{profile.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Email</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">{profile.email}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Tenant / Organization</p>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-0.5">{profile.tenant}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400">Could not load account information</p>
          )}
        </Card>

        {/* Plan Info */}
        <Card title="Plan & Usage">
          {planLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : plan ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-lg font-semibold text-gray-900 dark:text-slate-100 capitalize">{plan.plan} Plan</h4>
                    <Badge variant={
                      plan.plan === 'enterprise' ? 'info' :
                      plan.plan === 'growth' ? 'success' :
                      plan.plan === 'starter' ? 'warning' : 'neutral'
                    }>
                      {plan.plan.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
                    Billing cycle: {plan.billing_cycle_start ? new Date(plan.billing_cycle_start).toLocaleDateString() : 'N/A'}
                    {' - '}
                    {plan.billing_cycle_end ? new Date(plan.billing_cycle_end).toLocaleDateString() : 'N/A'}
                  </p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm text-gray-600 dark:text-slate-400">
                    {plan.usage.toLocaleString()} / {plan.limit.toLocaleString()} orders used
                  </span>
                  <span className={clsx(
                    'text-sm font-semibold',
                    usagePercent >= 90 ? 'text-red-600 dark:text-red-400' : usagePercent >= 70 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-900 dark:text-slate-100'
                  )}>
                    {usagePercent.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-3">
                  <div
                    className={clsx(
                      'h-3 rounded-full transition-all duration-500',
                      usagePercent >= 90 ? 'bg-red-500' : usagePercent >= 70 ? 'bg-yellow-500' : 'bg-blue-500'
                    )}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 dark:text-slate-400">Plan information not available</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Contact support for plan details</p>
            </div>
          )}
        </Card>

        {/* Scoring Thresholds */}
        <Card title="Scoring Thresholds" subtitle="Configure the risk score thresholds for automatic recommendations">
          <div className="space-y-6">
            {thresholdError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                <p className="text-sm text-red-700 dark:text-red-400">{thresholdError}</p>
              </div>
            )}
            {thresholdSuccess && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-sm text-green-700 dark:text-green-400">Thresholds saved successfully</p>
              </div>
            )}

            {/* Visual representation */}
            <div className="bg-gray-50 dark:bg-slate-700 rounded-xl p-4">
              <div className="relative h-8 bg-gradient-to-r from-green-400 via-yellow-400 to-red-500 rounded-full overflow-hidden">
                {/* Verify threshold marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
                  style={{ left: `${verifyThreshold}%` }}
                />
                {/* Block threshold marker */}
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white z-10"
                  style={{ left: `${blockThreshold}%` }}
                />
              </div>
              <div className="flex justify-between mt-2 text-xs text-gray-500 dark:text-slate-400">
                <span>0 - APPROVE</span>
                <span>{verifyThreshold} - VERIFY</span>
                <span>{blockThreshold} - BLOCK</span>
                <span>100</span>
              </div>
            </div>

            {/* Verify Threshold Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
                  Verify Threshold
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={verifyThreshold}
                    onChange={(e) => setVerifyThreshold(Math.min(Math.max(parseInt(e.target.value) || 0, 0), 100))}
                    className="w-16 px-2 py-1 text-sm text-center border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-500 dark:text-slate-400">/ 100</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={verifyThreshold}
                onChange={(e) => setVerifyThreshold(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Orders scoring above this threshold will be flagged for manual verification
              </p>
            </div>

            {/* Block Threshold Slider */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-slate-300">
                  Block Threshold
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={blockThreshold}
                    onChange={(e) => setBlockThreshold(Math.min(Math.max(parseInt(e.target.value) || 0, 0), 100))}
                    className="w-16 px-2 py-1 text-sm text-center border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-500 dark:text-slate-400">/ 100</span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={blockThreshold}
                onChange={(e) => setBlockThreshold(parseInt(e.target.value))}
                className="w-full h-2 bg-gray-200 dark:bg-slate-600 rounded-lg appearance-none cursor-pointer accent-red-500"
              />
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                Orders scoring above this threshold will be automatically blocked
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveThresholds}
                disabled={thresholdSaving}
                className="px-6 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {thresholdSaving ? 'Saving...' : 'Save Thresholds'}
              </button>
            </div>
          </div>
        </Card>

        {/* API Keys */}
        <Card
          title="API Keys"
          subtitle="Manage API keys for webhook and API integrations"
          action={
            <button
              onClick={generateApiKey}
              disabled={generatingKey}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {generatingKey ? 'Generating...' : 'Generate Key'}
            </button>
          }
        >
          {/* New key banner */}
          {newKey && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium text-green-800 dark:text-green-400 mb-2">
                New API key generated. Copy it now -- you will not be able to see it again.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-white dark:bg-slate-700 border border-green-200 dark:border-green-800 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 dark:text-slate-200 select-all">
                  {newKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newKey)}
                  className={clsx(
                    'px-3 py-2 text-sm font-medium rounded-lg transition-colors',
                    copiedKey
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 dark:bg-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-500'
                  )}
                >
                  {copiedKey ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {keysLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : apiKeys.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-gray-100 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500 dark:text-slate-400">No API keys yet</p>
              <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Generate a key to integrate with your e-commerce platform</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-slate-700">
                    <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Key Prefix</th>
                    <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Created</th>
                    <th className="text-left py-2 text-gray-500 dark:text-slate-400 font-medium">Last Used</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                  {apiKeys.map((key) => (
                    <tr key={key.id} className="hover:bg-gray-50 dark:hover:bg-slate-700/50">
                      <td className="py-2.5 pr-4">
                        <code className="bg-gray-50 dark:bg-slate-700 px-2 py-1 rounded text-xs font-mono text-gray-800 dark:text-slate-300">
                          {key.prefix}...
                        </code>
                      </td>
                      <td className="py-2.5 pr-4 text-gray-500 dark:text-slate-400 text-xs">
                        {new Date(key.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 text-gray-500 dark:text-slate-400 text-xs">
                        {key.last_used_at
                          ? new Date(key.last_used_at).toLocaleDateString()
                          : <span className="text-gray-400 dark:text-slate-500">Never</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}
