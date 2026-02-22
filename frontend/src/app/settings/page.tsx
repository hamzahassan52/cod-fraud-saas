'use client';

import { useEffect, useState } from 'react';
import { mlApi, shopifyApi, settingsApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import clsx from 'clsx';
import api from '@/lib/api';

interface UserProfile {
  name: string;
  email: string;
  tenant: string;
  tenant_id: string;
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

  // Webhook secrets (per-platform HMAC secrets)
  const [webhookSecretConfigured, setWebhookSecretConfigured] = useState<Record<string, boolean>>({});
  const [savingSecret, setSavingSecret] = useState<string | null>(null);

  // Integrations
  const [shopifyConnected, setShopifyConnected] = useState(false);
  const [shopifyShop, setShopifyShop] = useState('');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{
    webhook_registered: boolean; webhook_address?: string; error?: string;
  } | null>(null);
  const [shopifyModalOpen, setShopifyModalOpen] = useState(false);
  const [shopifyStoreInput, setShopifyStoreInput] = useState('');
  const [copiedWebhookUrl, setCopiedWebhookUrl] = useState<string | null>(null);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
    fetchApiKeys();
    fetchThresholds();
    fetchShopifyStatus();
    fetchWebhookSecrets();
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
      const res = await api.post('/auth/api-keys', {});
      const key = res.data.apiKey || res.data.key || res.data.api_key;
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

  const fetchWebhookSecrets = async () => {
    try {
      const res = await settingsApi.getWebhookSecrets();
      setWebhookSecretConfigured(res.data.configured || {});
    } catch {
      // Non-fatal
    }
  };

  const saveWebhookSecret = async (platform: string, secret: string) => {
    setSavingSecret(platform);
    try {
      await settingsApi.saveWebhookSecret(platform, secret);
      setWebhookSecretConfigured(prev => ({ ...prev, [platform]: true }));
      // Re-fetch to confirm saved in DB
      await fetchWebhookSecrets();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save webhook secret');
    } finally {
      setSavingSecret(null);
    }
  };

  const fetchShopifyStatus = async () => {
    try {
      const res = await shopifyApi.status();
      setShopifyConnected(res.data.connected || false);
      setShopifyShop(res.data.shop || '');
    } catch {
      setShopifyConnected(false);
    }
  };

  const connectShopify = () => {
    if (!shopifyStoreInput.trim()) return;
    let shop = shopifyStoreInput.trim().toLowerCase();
    if (!shop.includes('.myshopify.com')) shop = `${shop}.myshopify.com`;
    const tenantId = profile?.tenant_id || '';
    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || '';
    window.location.href = `${backendUrl}/api/v1/shopify/install?shop=${shop}&tenant_id=${tenantId}`;
  };

  const disconnectShopify = async () => {
    try {
      await shopifyApi.disconnect();
      setShopifyConnected(false);
      setShopifyShop('');
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to disconnect');
    }
  };

  const testShopifyWebhook = async () => {
    setTestingWebhook(true);
    setWebhookTestResult(null);
    try {
      const res = await shopifyApi.testWebhook();
      setWebhookTestResult(res.data);
    } catch (err: any) {
      setWebhookTestResult({
        webhook_registered: false,
        error: err.response?.data?.error || 'Test failed',
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  const getWebhookUrl = (platform: string) => {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'https://cod-fraud-saas-production.up.railway.app';
    const firstKey = apiKeys[0]?.prefix;
    const keyParam = firstKey ? `?api_key=${firstKey}...` : '';
    return `${backendUrl}/api/v1/webhook/${platform}${keyParam}`;
  };

  const getWebhookUrlFull = (platform: string) => {
    const backendUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'https://cod-fraud-saas-production.up.railway.app';
    return `${backendUrl}/api/v1/webhook/${platform}`;
  };

  const copyWebhookUrl = async (platform: string) => {
    const base = getWebhookUrlFull(platform);
    // For WooCommerce/Magento/Joomla, include ?api_key= hint (user replaces YOUR_KEY with actual key)
    const needsQueryAuth = ['woocommerce', 'magento', 'joomla'].includes(platform);
    const url = needsQueryAuth ? `${base}?api_key=YOUR_API_KEY` : base;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const t = document.createElement('textarea');
      t.value = url;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      document.body.removeChild(t);
    }
    setCopiedWebhookUrl(platform);
    setTimeout(() => setCopiedWebhookUrl(null), 2000);
  };

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
        <div className="rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-6 text-white">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20 text-2xl">
                ⚡
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-bold">Pro Plan</h3>
                  <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide">Active</span>
                </div>
                <p className="text-sm text-blue-100 mt-0.5">Full capacity — unlimited orders, all features, priority scoring</p>
              </div>
            </div>
            <div className="flex flex-col items-start sm:items-end gap-1">
              <div className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-blue-100">Unlimited order scoring</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-blue-100">ML + circuit breaker + zero order loss</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="h-4 w-4 text-green-300" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-sm text-blue-100">Shopify, WooCommerce, Magento, Joomla</span>
              </div>
            </div>
          </div>
        </div>

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
                <svg className="w-6 h-6 text-gray-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <p className="text-sm text-gray-500 dark:text-slate-400">No API keys yet</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Generate a key to integrate with your e-commerce platform</p>
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
                          : <span className="text-gray-500 dark:text-slate-400">Never</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        {/* Integrations */}
        <Card title="Platform Integrations" subtitle="Connect your e-commerce platforms to start receiving orders">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">

            {/* Shopify */}
            <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-green-50 dark:bg-green-900/20 text-xl">
                    🛍
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">Shopify</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className={clsx('h-1.5 w-1.5 rounded-full', shopifyConnected ? 'bg-green-500' : 'bg-gray-400')} />
                      <span className="text-xs text-gray-500 dark:text-slate-400">
                        {shopifyConnected ? shopifyShop : 'Not Connected'}
                      </span>
                    </div>
                  </div>
                </div>
                {shopifyConnected ? (
                  <button
                    onClick={disconnectShopify}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline"
                  >
                    Disconnect
                  </button>
                ) : (
                  <button
                    onClick={() => setShopifyModalOpen(true)}
                    className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
              {shopifyConnected && (
                <div className="mt-3">
                  <p className="text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-lg px-3 py-2">
                    ✅ Orders from {shopifyShop} are being automatically scored
                  </p>
                  <button
                    onClick={testShopifyWebhook}
                    disabled={testingWebhook}
                    className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                  >
                    {testingWebhook ? 'Checking...' : 'Test Webhook'}
                  </button>
                  {webhookTestResult && (
                    <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${
                      webhookTestResult.webhook_registered
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                        : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
                    }`}>
                      {webhookTestResult.webhook_registered
                        ? `Webhook active — ${webhookTestResult.webhook_address}`
                        : webhookTestResult.error || 'Webhook not found on Shopify'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* WooCommerce */}
            <WebhookPlatformCard
              platform="woocommerce"
              name="WooCommerce"
              emoji="🔌"
              copied={copiedWebhookUrl === 'woocommerce'}
              expanded={expandedPlatform === 'woocommerce'}
              onCopy={() => copyWebhookUrl('woocommerce')}
              onToggle={() => setExpandedPlatform(expandedPlatform === 'woocommerce' ? null : 'woocommerce')}
              secretConfigured={webhookSecretConfigured['woocommerce'] || false}
              savingSecret={savingSecret === 'woocommerce'}
              onSaveSecret={(s) => saveWebhookSecret('woocommerce', s)}
              instructions={[
                'Go to WooCommerce → Settings → Advanced → Webhooks',
                'Click "Add webhook" and set Topic to "Order created"',
                'Paste the Delivery URL above (replace YOUR_API_KEY with your actual key from the API Keys section)',
                'In the "Secret" field, enter the same value as your Webhook HMAC Secret below — this adds request signature verification',
                'Save and test with a new order',
              ]}
            />

            {/* Custom API */}
            <WebhookPlatformCard
              platform="api"
              name="Custom / REST API"
              emoji="⚡"
              copied={copiedWebhookUrl === 'api'}
              expanded={expandedPlatform === 'api'}
              onCopy={() => copyWebhookUrl('api')}
              onToggle={() => setExpandedPlatform(expandedPlatform === 'api' ? null : 'api')}
              instructions={[
                'Send a POST request to the webhook URL',
                'Include X-API-Key header with your API key',
                'Request body: { "order_id", "customer_name", "customer_phone", "total_amount", "city" }',
                'Response includes: risk_score, risk_level, recommendation',
              ]}
            />
          </div>
        </Card>

        {/* Shopify Connect Modal */}
        <Modal
          open={shopifyModalOpen}
          onClose={() => { setShopifyModalOpen(false); setShopifyStoreInput(''); }}
          title="Connect Shopify Store"
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-slate-400">
              Enter your Shopify store URL to begin the OAuth connection flow.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Store URL</label>
              <input
                type="text"
                placeholder="mystore.myshopify.com"
                value={shopifyStoreInput}
                onChange={(e) => setShopifyStoreInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && connectShopify()}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">e.g. mystore or mystore.myshopify.com</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => { setShopifyModalOpen(false); setShopifyStoreInput(''); }}
                className="rounded-lg border border-gray-200 dark:border-slate-600 px-4 py-2 text-sm text-gray-600 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={connectShopify}
                disabled={!shopifyStoreInput.trim()}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                Connect →
              </button>
            </div>
          </div>
        </Modal>
      </div>
    </DashboardLayout>
  );
}

interface WebhookPlatformCardProps {
  platform: string;
  name: string;
  emoji: string;
  copied: boolean;
  expanded: boolean;
  onCopy: () => void;
  onToggle: () => void;
  instructions: string[];
  secretConfigured?: boolean;
  savingSecret?: boolean;
  onSaveSecret?: (secret: string) => void;
}

function WebhookPlatformCard({
  platform, name, emoji, copied, expanded, onCopy, onToggle, instructions,
  secretConfigured, savingSecret, onSaveSecret,
}: WebhookPlatformCardProps) {
  const backendUrl = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'https://cod-fraud-saas-production.up.railway.app')
    : 'https://cod-fraud-saas-production.up.railway.app';

  const needsQueryAuth = ['woocommerce', 'magento', 'joomla'].includes(platform);
  const webhookUrl = needsQueryAuth
    ? `${backendUrl}/api/v1/webhook/${platform}?api_key=YOUR_API_KEY`
    : `${backendUrl}/api/v1/webhook/${platform}`;

  const [secretInput, setSecretInput] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-50 dark:bg-slate-700/50 text-xl">
            {emoji}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{name}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
              <span className="text-xs text-gray-500 dark:text-slate-400">Webhook Integration</span>
            </div>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
        >
          {expanded ? 'Hide' : 'Setup'}
        </button>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-500 dark:text-slate-400">Delivery URL</p>
          {needsQueryAuth && (
            <span className="text-[10px] bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded px-1.5 py-0.5">
              Replace YOUR_API_KEY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-lg bg-gray-50 dark:bg-slate-700 border border-gray-200 dark:border-slate-600 px-2 py-1.5 text-xs font-mono text-gray-700 dark:text-slate-300">
            {webhookUrl}
          </code>
          <button
            onClick={onCopy}
            className={clsx(
              'flex-shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
              copied
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                : 'bg-gray-100 dark:bg-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-500'
            )}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* HMAC Secret management (for non-Shopify platforms) */}
      {onSaveSecret && (
        <div className={clsx(
          'mt-3 rounded-lg border p-3 transition-colors',
          secretConfigured
            ? 'border-green-200 dark:border-green-800/50 bg-green-50/50 dark:bg-green-900/10'
            : 'border-gray-100 dark:border-slate-600/50'
        )}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <svg className={clsx('w-3.5 h-3.5', secretConfigured ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-slate-400')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className={clsx('text-xs font-medium', secretConfigured ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-slate-300')}>
                Webhook HMAC Secret
              </p>
            </div>
            {secretConfigured && (
              <span className="flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Secret Saved
              </span>
            )}
          </div>

          {/* Success banner after save */}
          {justSaved && (
            <div className="mb-2 rounded-lg bg-green-100 dark:bg-green-900/30 px-3 py-2 text-xs text-green-800 dark:text-green-300 font-medium">
              ✅ Secret saved! Now enter this same value in WooCommerce Secret field.
            </div>
          )}

          <p className="text-[11px] text-gray-500 dark:text-slate-400 mb-2">
            Enter the same value in your platform&apos;s webhook &quot;Secret&quot; field. Every request will be verified — forged orders are rejected.
          </p>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showSecret ? 'text' : 'password'}
                value={secretInput}
                onChange={(e) => setSecretInput(e.target.value)}
                placeholder={secretConfigured ? 'Secret saved — enter new value to update' : 'Enter a secret (min 8 chars)'}
                className="w-full rounded-lg border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 px-2.5 py-1.5 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowSecret(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300"
              >
                {showSecret ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            <button
              onClick={() => {
                if (secretInput.trim().length >= 8) {
                  onSaveSecret(secretInput.trim());
                  setSecretInput('');
                  setJustSaved(true);
                  setTimeout(() => setJustSaved(false), 5000);
                }
              }}
              disabled={savingSecret || secretInput.trim().length < 8}
              className="flex-shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {savingSecret ? 'Saving…' : 'Save'}
            </button>
          </div>
          {secretInput.length > 0 && secretInput.trim().length < 8 && (
            <p className="mt-1 text-[11px] text-red-500">Minimum 8 characters required</p>
          )}
        </div>
      )}

      {expanded && (
        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-slate-700/50 p-3">
          <p className="text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">Setup Instructions</p>
          <ol className="space-y-1.5">
            {instructions.map((step, i) => (
              <li key={i} className="flex gap-2 text-xs text-gray-600 dark:text-slate-400">
                <span className="flex-shrink-0 font-semibold text-gray-500 dark:text-slate-400">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
