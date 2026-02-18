-- Performance indexes for production scale
-- Run after initial schema

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_phone ON orders(tenant_id, phone_normalized);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_status_created ON orders(tenant_id, status, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_recommendation ON orders(tenant_id, recommendation, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_platform ON orders(tenant_id, platform, created_at DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_phone_status ON orders(phone_normalized, status);

-- Partial indexes for hot paths
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_pending ON orders(tenant_id, created_at DESC) WHERE status = 'pending';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_rto ON orders(tenant_id, created_at DESC) WHERE status = 'rto';

-- Fraud scores lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_scores_tenant_scored ON fraud_scores(tenant_id, scored_at DESC);

-- Blacklist fast lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blacklist_active ON blacklist(tenant_id, type, value_normalized) WHERE expires_at IS NULL OR expires_at > NOW();

-- Phone record lookup with ordering
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_phones_rto_rate_desc ON phones(rto_rate DESC) WHERE total_orders >= 3;

-- Risk logs time-based queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_risk_logs_tenant_created ON risk_logs(tenant_id, created_at DESC);

-- API keys fast auth lookup
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_active ON api_keys(key_hash) WHERE is_active = true;
