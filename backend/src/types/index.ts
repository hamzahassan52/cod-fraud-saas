// ============================================
// Core Types
// ============================================

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  plan: 'free' | 'starter' | 'growth' | 'enterprise';
  orderLimit: number;
  ordersUsed: number;
  settings: TenantSettings;
  isActive: boolean;
  createdAt: Date;
}

export interface TenantSettings {
  autoBlock?: boolean;
  blockThreshold?: number;
  verifyThreshold?: number;
  enableMlScoring?: boolean;
  webhookUrls?: Record<string, string>;
  customRules?: FraudRule[];
}

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  isActive: boolean;
}

export interface ApiKey {
  id: string;
  tenantId: string;
  keyHash: string;
  keyPrefix: string;
  name: string;
  permissions: string[];
  isActive: boolean;
}

export interface Order {
  id: string;
  tenantId: string;
  externalOrderId: string;
  platform: Platform;
  platformData: Record<string, unknown>;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  phoneNormalized?: string;
  phoneCarrier?: string;
  shippingAddress: Address;
  shippingCity?: string;
  shippingState?: string;
  shippingZip?: string;
  shippingCountry: string;
  paymentMethod: string;
  currency: string;
  totalAmount: number;
  itemsCount: number;
  lineItems: LineItem[];
  riskScore?: number;
  riskLevel?: RiskLevel;
  recommendation?: Recommendation;
  fraudSignals: FraudSignal[];
  status: OrderStatus;
  ipAddress?: string;
  userAgent?: string;
  isRepeatCustomer: boolean;
  previousOrderCount: number;
  previousRtoCount: number;
  createdAt: Date;
}

export interface Address {
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface LineItem {
  name: string;
  sku?: string;
  quantity: number;
  price: number;
}

export interface FraudSignal {
  signal: string;
  score: number;
  layer: 'rule' | 'statistical' | 'ml';
  description?: string;
}

export interface FraudScore {
  id: string;
  orderId: string;
  tenantId: string;
  ruleScore: number;
  statisticalScore: number;
  mlScore: number;
  finalScore: number;
  confidence: number;
  signals: FraudSignal[];
  mlFeatures: Record<string, number>;
  mlModelVersion?: string;
  scoringDurationMs: number;
}

export interface FraudRule {
  id: string;
  name: string;
  condition: string;
  score: number;
  isActive: boolean;
}

export interface PhoneRecord {
  id: string;
  phoneNormalized: string;
  carrier?: string;
  totalOrders: number;
  totalRto: number;
  rtoRate: number;
  isBlacklisted: boolean;
  riskTier: string;
}

export interface BlacklistEntry {
  id: string;
  tenantId: string;
  type: 'phone' | 'email' | 'address' | 'ip' | 'name';
  value: string;
  valueNormalized: string;
  reason?: string;
  isGlobal: boolean;
}

export interface MLTopFactor {
  feature: string;
  value: number;
  impact: number;
  direction: 'increases_risk' | 'decreases_risk';
}

export interface MLPrediction {
  score: number;
  confidence: number;
  modelVersion: string;
  features: Record<string, number>;
  topFactors?: MLTopFactor[];
}

export interface RtoReport {
  id: string;
  tenantId: string;
  orderId: string;
  outcome: 'delivered' | 'rto' | 'partial_rto';
  rtoReason?: string;
}

// Enums
export type Platform = 'shopify' | 'woocommerce' | 'magento' | 'joomla' | 'api';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Recommendation = 'APPROVE' | 'VERIFY' | 'BLOCK';
export type OrderStatus = 'pending' | 'scored' | 'approved' | 'blocked' | 'verified' | 'delivered' | 'rto';

// Request/Response types
export interface NormalizedWebhookOrder {
  externalOrderId: string;
  platform: Platform;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  shippingAddress: Address;
  totalAmount: number;
  currency: string;
  itemsCount: number;
  lineItems: LineItem[];
  paymentMethod: string;
  ipAddress?: string;
  userAgent?: string;
  platformData: Record<string, unknown>;
}

export interface ScoringResult {
  orderId: string;
  riskScore: number;
  riskLevel: RiskLevel;
  recommendation: Recommendation;
  signals: FraudSignal[];
  recommendationReasons: string[];
  riskSummary: string;
  scoring: {
    ruleScore: number;
    statisticalScore: number;
    mlScore: number;
  };
  confidence: number;
  modelVersion?: string;
  mlFeatures?: Record<string, number>;
  durationMs: number;
}

export interface AnalyticsData {
  totalOrders: number;
  approvedOrders: number;
  blockedOrders: number;
  verifyOrders: number;
  totalRto: number;
  rtoRate: number;
  avgRiskScore: number;
  topFraudSignals: { signal: string; count: number }[];
  riskDistribution: { level: string; count: number }[];
  dailyOrders: { date: string; total: number; rto: number }[];
}

// Auth
export interface JwtPayload {
  userId: string;
  tenantId: string;
  role: string;
}

export interface ApiKeyPayload {
  tenantId: string;
  keyId: string;
  permissions: string[];
}
