import client from 'prom-client';

// Create a Registry
const register = new client.Registry();

// Default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register, prefix: 'codfraud_' });

// ============================================
// Custom Metrics
// ============================================

// HTTP request metrics
export const httpRequestDuration = new client.Histogram({
  name: 'codfraud_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code', 'tenant_id'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: 'codfraud_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

// Fraud scoring metrics
export const fraudScoringDuration = new client.Histogram({
  name: 'codfraud_fraud_scoring_duration_ms',
  help: 'Time taken to score an order in ms',
  labelNames: ['tenant_id', 'recommendation'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

export const fraudScoringTotal = new client.Counter({
  name: 'codfraud_fraud_scoring_total',
  help: 'Total fraud scoring operations',
  labelNames: ['recommendation', 'risk_level'],
  registers: [register],
});

// ML inference metrics
export const mlInferenceDuration = new client.Histogram({
  name: 'codfraud_ml_inference_duration_ms',
  help: 'ML model inference time in ms',
  labelNames: ['model_version', 'status'],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
  registers: [register],
});

export const mlInferenceTotal = new client.Counter({
  name: 'codfraud_ml_inference_total',
  help: 'Total ML inference calls',
  labelNames: ['status'], // success, failure, fallback
  registers: [register],
});

// Queue metrics
export const queueWaitTime = new client.Histogram({
  name: 'codfraud_queue_wait_time_ms',
  help: 'Time orders spend waiting in queue before scoring',
  buckets: [100, 500, 1000, 2500, 5000, 10000, 30000],
  registers: [register],
});

export const queueSize = new client.Gauge({
  name: 'codfraud_queue_size',
  help: 'Current scoring queue size',
  registers: [register],
});

export const queueJobsProcessed = new client.Counter({
  name: 'codfraud_queue_jobs_processed_total',
  help: 'Total queue jobs processed',
  labelNames: ['status'], // completed, failed
  registers: [register],
});

// Webhook metrics
export const webhookTotal = new client.Counter({
  name: 'codfraud_webhook_total',
  help: 'Total webhooks received',
  labelNames: ['platform', 'status'], // status: accepted, rejected, invalid
  registers: [register],
});

// Error rate
export const errorTotal = new client.Counter({
  name: 'codfraud_errors_total',
  help: 'Total errors',
  labelNames: ['type'], // validation, auth, db, ml, internal
  registers: [register],
});

// Active tenants gauge
export const activeTenants = new client.Gauge({
  name: 'codfraud_active_tenants',
  help: 'Number of active tenants',
  registers: [register],
});

// Orders processed today
export const ordersToday = new client.Gauge({
  name: 'codfraud_orders_today',
  help: 'Orders processed today',
  registers: [register],
});

export { register };
