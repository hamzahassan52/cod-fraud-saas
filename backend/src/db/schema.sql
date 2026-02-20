-- ============================================
-- COD Fraud Detection SaaS - Database Schema
-- PostgreSQL 15+
-- ============================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- TENANTS (Multi-tenant SaaS)
-- ============================================
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    domain VARCHAR(255),
    plan VARCHAR(50) NOT NULL DEFAULT 'free', -- free, starter, growth, enterprise
    order_limit INTEGER NOT NULL DEFAULT 100, -- monthly order limit per plan
    orders_used INTEGER NOT NULL DEFAULT 0,
    billing_cycle_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tenants_slug ON tenants(slug);
CREATE INDEX idx_tenants_plan ON tenants(plan);

-- ============================================
-- USERS
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member', -- owner, admin, member
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, email)
);

CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_users_email ON users(email);

-- ============================================
-- API KEYS
-- ============================================
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    key_prefix VARCHAR(12) NOT NULL, -- first 8 chars for identification
    name VARCHAR(255) NOT NULL,
    permissions JSONB DEFAULT '["read", "write"]',
    is_active BOOLEAN DEFAULT true,
    last_used_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_prefix ON api_keys(key_prefix);

-- ============================================
-- ORDERS
-- ============================================
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    external_order_id VARCHAR(255) NOT NULL,
    platform VARCHAR(50) NOT NULL, -- shopify, woocommerce, magento, joomla, api
    platform_data JSONB DEFAULT '{}', -- raw webhook data

    -- Customer info
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    phone_normalized VARCHAR(20), -- normalized Pakistani format
    phone_carrier VARCHAR(50),

    -- Address
    shipping_address JSONB DEFAULT '{}',
    shipping_city VARCHAR(100),
    shipping_state VARCHAR(100),
    shipping_zip VARCHAR(20),
    shipping_country VARCHAR(10) DEFAULT 'PK',

    -- Order details
    payment_method VARCHAR(50) DEFAULT 'COD',
    currency VARCHAR(10) DEFAULT 'PKR',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    items_count INTEGER DEFAULT 0,
    line_items JSONB DEFAULT '[]',

    -- Risk assessment
    risk_score DECIMAL(5,2),
    risk_level VARCHAR(20), -- LOW, MEDIUM, HIGH, CRITICAL
    recommendation VARCHAR(20), -- APPROVE, VERIFY, BLOCK
    fraud_signals JSONB DEFAULT '[]',
    recommendation_reasons JSONB DEFAULT '[]',
    risk_summary TEXT,

    -- Status
    status VARCHAR(50) DEFAULT 'pending', -- pending, scored, approved, blocked, verified, delivered, rto
    scored_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    rto_at TIMESTAMP WITH TIME ZONE,

    -- Metadata
    ip_address VARCHAR(45),
    user_agent TEXT,
    is_repeat_customer BOOLEAN DEFAULT false,
    previous_order_count INTEGER DEFAULT 0,
    previous_rto_count INTEGER DEFAULT 0,

    -- Override tracking
    override_recommendation VARCHAR(20),
    override_reason TEXT,
    override_by UUID REFERENCES users(id),
    override_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, external_order_id, platform)
);

CREATE INDEX idx_orders_tenant ON orders(tenant_id);
CREATE INDEX idx_orders_phone ON orders(phone_normalized);
CREATE INDEX idx_orders_platform ON orders(platform);
CREATE INDEX idx_orders_risk ON orders(risk_score);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_recommendation ON orders(recommendation);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_tenant_created ON orders(tenant_id, created_at DESC);
CREATE INDEX idx_orders_customer_email ON orders(customer_email);
CREATE INDEX idx_orders_shipping_city ON orders(shipping_city);

-- ============================================
-- PHONES (Phone intelligence)
-- ============================================
CREATE TABLE phones (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_normalized VARCHAR(20) UNIQUE NOT NULL,
    raw_formats TEXT[] DEFAULT '{}', -- all formats seen
    carrier VARCHAR(50),
    phone_type VARCHAR(20), -- mobile, landline, unknown
    region VARCHAR(50),
    total_orders INTEGER DEFAULT 0,
    total_rto INTEGER DEFAULT 0,
    rto_rate DECIMAL(5,4) DEFAULT 0,
    total_amount_ordered DECIMAL(14,2) DEFAULT 0,
    first_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_blacklisted BOOLEAN DEFAULT false,
    risk_tier VARCHAR(20) DEFAULT 'unknown', -- low, medium, high, blacklisted
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_phones_normalized ON phones(phone_normalized);
CREATE INDEX idx_phones_risk ON phones(risk_tier);
CREATE INDEX idx_phones_rto_rate ON phones(rto_rate);
CREATE INDEX idx_phones_blacklisted ON phones(is_blacklisted);

-- ============================================
-- ADDRESSES (Address intelligence)
-- ============================================
CREATE TABLE addresses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    address_hash VARCHAR(64) NOT NULL, -- SHA256 of normalized address
    raw_address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    zip VARCHAR(20),
    country VARCHAR(10) DEFAULT 'PK',
    total_orders INTEGER DEFAULT 0,
    total_rto INTEGER DEFAULT 0,
    rto_rate DECIMAL(5,4) DEFAULT 0,
    unique_phones INTEGER DEFAULT 0,
    unique_names INTEGER DEFAULT 0,
    risk_tier VARCHAR(20) DEFAULT 'unknown',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, address_hash)
);

CREATE INDEX idx_addresses_hash ON addresses(address_hash);
CREATE INDEX idx_addresses_city ON addresses(city);
CREATE INDEX idx_addresses_risk ON addresses(risk_tier);

-- ============================================
-- FRAUD SCORES (Detailed scoring breakdown)
-- ============================================
CREATE TABLE fraud_scores (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- Layer scores
    rule_score DECIMAL(5,2) DEFAULT 0,       -- Layer 1: Rule-based
    statistical_score DECIMAL(5,2) DEFAULT 0, -- Layer 2: Statistical
    ml_score DECIMAL(5,2) DEFAULT 0,          -- Layer 3: ML prediction

    -- Final combined
    final_score DECIMAL(5,2) NOT NULL,
    confidence DECIMAL(5,4) DEFAULT 0,

    -- Weights used
    rule_weight DECIMAL(3,2) DEFAULT 0.30,
    statistical_weight DECIMAL(3,2) DEFAULT 0.30,
    ml_weight DECIMAL(3,2) DEFAULT 0.40,

    -- Signals breakdown
    signals JSONB DEFAULT '[]',
    -- Example: [{"signal": "high_rto_phone", "score": 25, "layer": "rule"}, ...]

    -- Features sent to ML
    ml_features JSONB DEFAULT '{}',
    ml_model_version VARCHAR(50),

    scored_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    scoring_duration_ms INTEGER DEFAULT 0
);

CREATE INDEX idx_fraud_scores_order ON fraud_scores(order_id);
CREATE INDEX idx_fraud_scores_tenant ON fraud_scores(tenant_id);
CREATE INDEX idx_fraud_scores_final ON fraud_scores(final_score);

-- ============================================
-- BLACKLIST
-- ============================================
CREATE TABLE blacklist (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL, -- phone, email, address, ip, name
    value VARCHAR(255) NOT NULL,
    value_normalized VARCHAR(255),
    reason TEXT,
    added_by UUID REFERENCES users(id),
    is_global BOOLEAN DEFAULT false, -- global = cross-tenant
    expires_at TIMESTAMP WITH TIME ZONE, -- null = permanent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, type, value_normalized)
);

CREATE INDEX idx_blacklist_tenant ON blacklist(tenant_id);
CREATE INDEX idx_blacklist_type_value ON blacklist(type, value_normalized);
CREATE INDEX idx_blacklist_global ON blacklist(is_global) WHERE is_global = true;

-- ============================================
-- RTO REPORTS (Feedback loop for ML training)
-- ============================================
CREATE TABLE rto_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    outcome VARCHAR(20) NOT NULL, -- delivered, rto, partial_rto
    rto_reason VARCHAR(100), -- refused, unreachable, fake_address, changed_mind, etc.
    reported_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    reported_by UUID REFERENCES users(id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_rto_reports_tenant ON rto_reports(tenant_id);
CREATE INDEX idx_rto_reports_order ON rto_reports(order_id);
CREATE INDEX idx_rto_reports_outcome ON rto_reports(outcome);

-- ============================================
-- MODEL VERSIONS (ML model tracking)
-- ============================================
CREATE TABLE model_versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    version VARCHAR(50) NOT NULL UNIQUE,
    model_type VARCHAR(50) NOT NULL, -- xgboost, random_forest
    accuracy DECIMAL(5,4),
    precision_score DECIMAL(5,4),
    recall DECIMAL(5,4),
    f1_score DECIMAL(5,4),
    auc_roc DECIMAL(5,4),
    training_samples INTEGER,
    feature_count INTEGER,
    feature_importance JSONB DEFAULT '{}',
    file_path VARCHAR(500),
    is_active BOOLEAN DEFAULT false, -- only one active at a time
    trained_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    activated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_model_versions_active ON model_versions(is_active) WHERE is_active = true;
CREATE INDEX idx_model_versions_version ON model_versions(version);

-- ============================================
-- RISK LOGS (Audit trail)
-- ============================================
CREATE TABLE risk_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    order_id UUID REFERENCES orders(id),
    action VARCHAR(50) NOT NULL, -- scored, overridden, approved, blocked, blacklisted
    actor_type VARCHAR(20) NOT NULL, -- system, user, api
    actor_id UUID,
    previous_state JSONB,
    new_state JSONB,
    metadata JSONB DEFAULT '{}',
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_risk_logs_tenant ON risk_logs(tenant_id);
CREATE INDEX idx_risk_logs_order ON risk_logs(order_id);
CREATE INDEX idx_risk_logs_action ON risk_logs(action);
CREATE INDEX idx_risk_logs_created ON risk_logs(created_at DESC);

-- ============================================
-- SUBSCRIPTION PLANS (SaaS billing)
-- ============================================
CREATE TABLE subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    display_name VARCHAR(100) NOT NULL,
    monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    annual_price DECIMAL(10,2) NOT NULL DEFAULT 0,
    order_limit INTEGER NOT NULL, -- monthly
    features JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default plans
INSERT INTO subscription_plans (name, display_name, monthly_price, annual_price, order_limit, features) VALUES
('free', 'Free', 0, 0, 100, '{"api_access": true, "dashboard": true, "webhooks": 1, "ml_scoring": false}'),
('starter', 'Starter', 2999, 29990, 1000, '{"api_access": true, "dashboard": true, "webhooks": 3, "ml_scoring": true, "blacklist": true}'),
('growth', 'Growth', 7999, 79990, 10000, '{"api_access": true, "dashboard": true, "webhooks": 10, "ml_scoring": true, "blacklist": true, "analytics": true, "export": true}'),
('enterprise', 'Enterprise', 19999, 199990, 100000, '{"api_access": true, "dashboard": true, "webhooks": -1, "ml_scoring": true, "blacklist": true, "analytics": true, "export": true, "custom_rules": true, "dedicated_support": true}');

-- ============================================
-- Helper function: update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- PREDICTION LOGS (ML audit trail)
-- ============================================
CREATE TABLE prediction_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    risk_score DECIMAL(5,2),
    recommendation VARCHAR(20),
    rule_score DECIMAL(5,2),
    statistical_score DECIMAL(5,2),
    ml_score DECIMAL(5,2),
    ml_model_version VARCHAR(50),
    ml_top_factors JSONB DEFAULT '[]',
    recommendation_reasons JSONB DEFAULT '[]',
    risk_summary TEXT,
    confidence DECIMAL(5,4),
    scoring_duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_prediction_logs_order ON prediction_logs(order_id);
CREATE INDEX idx_prediction_logs_tenant ON prediction_logs(tenant_id);
CREATE INDEX idx_prediction_logs_created ON prediction_logs(created_at DESC);

-- ============================================
-- PERFORMANCE SNAPSHOTS (Weekly metrics)
-- ============================================
CREATE TABLE performance_snapshots (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type VARCHAR(20) DEFAULT 'weekly',
    total_orders INTEGER DEFAULT 0,
    total_blocked INTEGER DEFAULT 0,
    total_approved INTEGER DEFAULT 0,
    total_verified INTEGER DEFAULT 0,
    blocked_rto INTEGER DEFAULT 0,
    blocked_delivered INTEGER DEFAULT 0,
    approved_rto INTEGER DEFAULT 0,
    approved_delivered INTEGER DEFAULT 0,
    precision_at_block DECIMAL(5,4),
    recall DECIMAL(5,4),
    f1_score DECIMAL(5,4),
    avg_risk_score DECIMAL(5,2),
    model_version VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id, period_start, period_type)
);

CREATE INDEX idx_performance_snapshots_tenant ON performance_snapshots(tenant_id);
CREATE INDEX idx_performance_snapshots_period ON performance_snapshots(period_start DESC);
CREATE TRIGGER update_phones_updated_at BEFORE UPDATE ON phones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_addresses_updated_at BEFORE UPDATE ON addresses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- SHOPIFY CONNECTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS shopify_connections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    shop VARCHAR(255) NOT NULL,
    access_token TEXT NOT NULL,
    scopes TEXT,
    webhook_id VARCHAR(255),
    installed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(tenant_id),
    UNIQUE(shop)
);

CREATE INDEX idx_shopify_connections_tenant ON shopify_connections(tenant_id);
CREATE INDEX idx_shopify_connections_shop ON shopify_connections(shop);
