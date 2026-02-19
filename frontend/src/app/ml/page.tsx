'use client';

import { useEffect, useState } from 'react';
import { mlApi } from '@/lib/api';
import DashboardLayout from '@/components/layout/dashboard-layout';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import clsx from 'clsx';

interface ModelMetrics {
  model_info?: {
    version: string;
    model_type: string;
    trained_at: string;
    training_samples: number;
    feature_count: number;
  };
  performance?: {
    accuracy: number;
    precision: number;
    recall: number;
    f1_score: number;
    auc_roc: number;
  };
  feature_importance?: Array<{ feature: string; importance: number }>;
}

interface ConfusionMatrixData {
  true_positives: number;
  true_negatives: number;
  false_positives: number;
  false_negatives: number;
  total: number;
}

interface ModelVersion {
  version: string;
  model_type: string;
  trained_at: string;
  accuracy: number;
  is_active: boolean;
}

interface HealthStatus {
  status: string;
  model_loaded: boolean;
  version: string;
  uptime: number;
  last_prediction: string;
}

function MetricCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm p-5">
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">{label}</p>
      <p className={clsx('text-3xl font-bold', color || 'text-gray-900 dark:text-slate-100')}>{value}</p>
    </div>
  );
}

function FeatureBar({ feature, importance, maxImportance }: { feature: string; importance: number; maxImportance: number }) {
  const width = maxImportance > 0 ? (importance / maxImportance) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-40 text-sm text-gray-700 dark:text-slate-300 font-medium truncate flex-shrink-0" title={feature}>
        {feature.replace(/_/g, ' ')}
      </div>
      <div className="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-5 relative">
        <div
          className="h-5 rounded-full bg-gradient-to-r from-blue-400 to-blue-600 transition-all duration-500"
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="w-16 text-sm text-gray-600 dark:text-slate-400 text-right font-mono flex-shrink-0">
        {(importance * 100).toFixed(1)}%
      </div>
    </div>
  );
}

export default function MLPage() {
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [confusion, setConfusion] = useState<ConfusionMatrixData | null>(null);
  const [versions, setVersions] = useState<ModelVersion[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);

  const [metricsLoading, setMetricsLoading] = useState(true);
  const [confusionLoading, setConfusionLoading] = useState(true);
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(true);

  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [confusionDays, setConfusionDays] = useState(30);

  useEffect(() => {
    fetchMetrics();
    fetchVersions();
    fetchHealth();
  }, []);

  useEffect(() => {
    fetchConfusion();
  }, [confusionDays]);

  const fetchMetrics = async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const res = await mlApi.metrics();
      setMetrics(res.data);
    } catch (err: any) {
      setMetricsError(err.response?.data?.message || 'Failed to load ML metrics');
    } finally {
      setMetricsLoading(false);
    }
  };

  const fetchConfusion = async () => {
    setConfusionLoading(true);
    try {
      const res = await mlApi.confusionMatrix(confusionDays);
      setConfusion(res.data);
    } catch {
      // Silently handle - not critical
    } finally {
      setConfusionLoading(false);
    }
  };

  const fetchVersions = async () => {
    setVersionsLoading(true);
    try {
      const res = await mlApi.versions();
      setVersions(res.data.versions || res.data || []);
    } catch {
      // Silently handle
    } finally {
      setVersionsLoading(false);
    }
  };

  const fetchHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await mlApi.health();
      setHealth(res.data);
    } catch {
      setHealth({ status: 'unhealthy', model_loaded: false, version: 'N/A', uptime: 0, last_prediction: '' });
    } finally {
      setHealthLoading(false);
    }
  };

  const perf = metrics?.performance;
  const modelInfo = metrics?.model_info;
  const features = metrics?.feature_importance || [];
  const topFeatures = features.slice(0, 10);
  const maxImportance = topFeatures.length > 0 ? Math.max(...topFeatures.map((f) => f.importance)) : 1;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">ML Model Insights</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Monitor model performance, feature importance, and service health
            </p>
          </div>

          {/* Health Indicator */}
          {!healthLoading && health && (
            <div className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
              health.status === 'healthy' || health.status === 'ok'
                ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400'
            )}>
              <span className={clsx(
                'w-2.5 h-2.5 rounded-full',
                health.status === 'healthy' || health.status === 'ok'
                  ? 'bg-green-500 animate-pulse'
                  : 'bg-red-500'
              )} />
              ML Service {health.status === 'healthy' || health.status === 'ok' ? 'Healthy' : 'Unhealthy'}
            </div>
          )}
        </div>

        {/* Error State */}
        {metricsError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-red-800 dark:text-red-300">Could not load ML metrics</p>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{metricsError}</p>
              </div>
              <button
                onClick={fetchMetrics}
                className="ml-auto text-sm text-red-700 dark:text-red-400 hover:underline font-medium"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {metricsLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
              <p className="mt-4 text-sm text-gray-500 dark:text-slate-400">Loading ML metrics...</p>
            </div>
          </div>
        ) : metrics && (
          <>
            {/* Model Info */}
            {modelInfo && (
              <Card title="Model Information">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Version</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">{modelInfo.version}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Type</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">{modelInfo.model_type}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Trained</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">
                      {modelInfo.trained_at ? new Date(modelInfo.trained_at).toLocaleDateString() : 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Training Samples</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">
                      {modelInfo.training_samples?.toLocaleString() || 'N/A'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Features</p>
                    <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 mt-0.5">{modelInfo.feature_count || 'N/A'}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Performance Metrics */}
            {perf && (
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-3">Performance Metrics</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <MetricCard
                    label="Accuracy"
                    value={`${(perf.accuracy * 100).toFixed(1)}%`}
                    color={perf.accuracy >= 0.9 ? 'text-green-600 dark:text-green-400' : perf.accuracy >= 0.8 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <MetricCard
                    label="Precision"
                    value={`${(perf.precision * 100).toFixed(1)}%`}
                    color={perf.precision >= 0.9 ? 'text-green-600 dark:text-green-400' : perf.precision >= 0.8 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <MetricCard
                    label="Recall"
                    value={`${(perf.recall * 100).toFixed(1)}%`}
                    color={perf.recall >= 0.9 ? 'text-green-600 dark:text-green-400' : perf.recall >= 0.8 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <MetricCard
                    label="F1 Score"
                    value={`${(perf.f1_score * 100).toFixed(1)}%`}
                    color={perf.f1_score >= 0.9 ? 'text-green-600 dark:text-green-400' : perf.f1_score >= 0.8 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}
                  />
                  <MetricCard
                    label="AUC-ROC"
                    value={`${(perf.auc_roc * 100).toFixed(1)}%`}
                    color={perf.auc_roc >= 0.9 ? 'text-green-600 dark:text-green-400' : perf.auc_roc >= 0.8 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-600 dark:text-red-400'}
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Confusion Matrix */}
              <Card
                title="Confusion Matrix"
                action={
                  <div className="flex gap-1">
                    {[7, 30, 90].map((d) => (
                      <button
                        key={d}
                        onClick={() => setConfusionDays(d)}
                        className={clsx(
                          'px-3 py-1 rounded-md text-xs font-medium transition-colors',
                          confusionDays === d
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-600'
                        )}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                }
              >
                {confusionLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                  </div>
                ) : confusion ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 max-w-xs mx-auto">
                      <div className="col-span-2 flex justify-center mb-1">
                        <span className="text-xs font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wider">Predicted</span>
                      </div>

                      <div className="bg-green-100 dark:bg-green-900/30 border-2 border-green-300 dark:border-green-700 rounded-xl p-4 text-center">
                        <p className="text-xs text-green-600 dark:text-green-400 font-medium mb-1">True Positive</p>
                        <p className="text-2xl font-bold text-green-800 dark:text-green-300">{confusion.true_positives}</p>
                      </div>

                      <div className="bg-red-50 dark:bg-red-900/20 border-2 border-red-200 dark:border-red-800 rounded-xl p-4 text-center">
                        <p className="text-xs text-red-500 dark:text-red-400 font-medium mb-1">False Positive</p>
                        <p className="text-2xl font-bold text-red-700 dark:text-red-300">{confusion.false_positives}</p>
                      </div>

                      <div className="bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-200 dark:border-orange-800 rounded-xl p-4 text-center">
                        <p className="text-xs text-orange-500 dark:text-orange-400 font-medium mb-1">False Negative</p>
                        <p className="text-2xl font-bold text-orange-700 dark:text-orange-300">{confusion.false_negatives}</p>
                      </div>

                      <div className="bg-green-50 dark:bg-green-900/20 border-2 border-green-200 dark:border-green-700 rounded-xl p-4 text-center">
                        <p className="text-xs text-green-500 dark:text-green-400 font-medium mb-1">True Negative</p>
                        <p className="text-2xl font-bold text-green-700 dark:text-green-300">{confusion.true_negatives}</p>
                      </div>
                    </div>

                    <div className="flex justify-between pt-2 border-t border-gray-100 dark:border-slate-700">
                      <div className="text-center">
                        <p className="text-xs text-gray-500 dark:text-slate-400">Total Predictions</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{confusion.total?.toLocaleString()}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-gray-500 dark:text-slate-400">Accuracy</p>
                        <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                          {confusion.total > 0
                            ? (((confusion.true_positives + confusion.true_negatives) / confusion.total) * 100).toFixed(1)
                            : '0.0'}%
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500 dark:text-slate-400">No confusion matrix data available</p>
                  </div>
                )}
              </Card>

              {/* Feature Importance */}
              <Card title="Feature Importance" subtitle="Top 10 most important features">
                {topFeatures.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500 dark:text-slate-400">No feature importance data available</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {topFeatures.map((f) => (
                      <FeatureBar
                        key={f.feature}
                        feature={f.feature}
                        importance={f.importance}
                        maxImportance={maxImportance}
                      />
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {/* Model Versions */}
            <Card title="Model Versions">
              {versionsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
              ) : versions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 dark:text-slate-400">No model versions found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-slate-700">
                        <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Version</th>
                        <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Type</th>
                        <th className="text-left py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Trained</th>
                        <th className="text-right py-2 pr-4 text-gray-500 dark:text-slate-400 font-medium">Accuracy</th>
                        <th className="text-right py-2 text-gray-500 dark:text-slate-400 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-slate-700/50">
                      {versions.map((v) => (
                        <tr key={v.version} className="hover:bg-gray-50 dark:hover:bg-slate-700/30">
                          <td className="py-2.5 pr-4 font-mono text-sm font-medium text-gray-900 dark:text-slate-100">{v.version}</td>
                          <td className="py-2.5 pr-4 text-gray-600 dark:text-slate-400">{v.model_type}</td>
                          <td className="py-2.5 pr-4 text-gray-500 dark:text-slate-400 text-xs">
                            {v.trained_at ? new Date(v.trained_at).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-2.5 pr-4 text-right font-medium text-gray-900 dark:text-slate-100">
                            {v.accuracy ? `${(v.accuracy * 100).toFixed(1)}%` : 'N/A'}
                          </td>
                          <td className="py-2.5 text-right">
                            {v.is_active ? (
                              <Badge variant="success">Active</Badge>
                            ) : (
                              <Badge variant="neutral">Inactive</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ML Service Health Details */}
            {health && (
              <Card title="ML Service Health">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Status</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={clsx(
                        'w-2 h-2 rounded-full',
                        health.status === 'healthy' || health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'
                      )} />
                      <p className="text-sm font-medium text-gray-900 dark:text-slate-100 capitalize">{health.status}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Model Loaded</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-1">
                      {health.model_loaded ? 'Yes' : 'No'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Version</p>
                    <p className="text-sm font-mono font-medium text-gray-900 dark:text-slate-100 mt-1">{health.version}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 dark:text-slate-400 uppercase tracking-wide">Uptime</p>
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100 mt-1">
                      {health.uptime
                        ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`
                        : 'N/A'}
                    </p>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
