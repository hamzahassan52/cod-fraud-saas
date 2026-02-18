import { FeatureExtractor, OrderFeatures } from './feature-extractor';
import { evaluateRules, RuleSignal } from './rules';
import { evaluateStatistical } from './statistical';
import { MLClient } from '../ml-client';
import { FraudSignal, RiskLevel, Recommendation, ScoringResult, MLTopFactor } from '../../types';

/**
 * FraudEngine - Core scoring orchestrator
 *
 * Combines 3 layers:
 *   Layer 1: Rule-based (deterministic)     - weight: 0.30
 *   Layer 2: Statistical (historical data)  - weight: 0.30
 *   Layer 3: ML prediction (model-based)    - weight: 0.40
 *
 * Configurable weights per tenant.
 */

interface EngineWeights {
  rule: number;
  statistical: number;
  ml: number;
}

const DEFAULT_WEIGHTS: EngineWeights = {
  rule: 0.30,
  statistical: 0.30,
  ml: 0.40,
};

// Thresholds for recommendations
const THRESHOLDS = {
  block: 70,    // >= 70: BLOCK
  verify: 40,   // >= 40: VERIFY
  approve: 0,   // < 40: APPROVE
};

// Human-readable labels for ML feature names
const ML_FEATURE_LABELS: Record<string, string> = {
  customer_rto_rate: 'customer RTO rate',
  phone_rto_rate: 'phone RTO rate',
  city_rto_rate: 'city RTO rate',
  address_rto_rate: 'address RTO rate',
  order_amount: 'order amount',
  is_cod: 'COD payment',
  is_first_order: 'first-time order',
  is_night_order: 'late-night order',
  phone_valid: 'phone validity',
  phone_mobile: 'mobile phone',
  phone_order_count: 'phone order history',
  phone_unique_addresses: 'phone address diversity',
  address_unique_phones: 'address phone diversity',
  is_high_value: 'high-value order',
  is_repeat_customer: 'repeat customer',
  previous_order_count: 'previous orders',
  previous_rto_count: 'previous RTOs',
  address_complete: 'address completeness',
  phone_blacklisted: 'blacklisted phone',
  email_blacklisted: 'blacklisted email',
  phone_is_blacklisted: 'blacklisted phone',
};

export class FraudEngine {
  private tenantId: string;
  private featureExtractor: FeatureExtractor;
  private mlClient: MLClient;
  private weights: EngineWeights;

  constructor(tenantId: string, weights?: Partial<EngineWeights>) {
    this.tenantId = tenantId;
    this.featureExtractor = new FeatureExtractor(tenantId);
    this.mlClient = new MLClient();
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  async scoreOrder(order: Record<string, any>): Promise<ScoringResult> {
    const startTime = Date.now();

    // Step 1: Extract features
    const features = await this.featureExtractor.extract(order);

    // Step 2: Run all 3 layers in parallel
    const [ruleResult, statResult, mlResult] = await Promise.all([
      this.runRuleLayer(features),
      this.runStatisticalLayer(features),
      this.runMLLayer(features),
    ]);

    // Step 3: Combine scores
    const allSignals: FraudSignal[] = [
      ...ruleResult.signals,
      ...statResult.signals,
      ...mlResult.signals,
    ];

    // Weighted combination
    let finalScore =
      ruleResult.score * this.weights.rule +
      statResult.score * this.weights.statistical +
      mlResult.score * this.weights.ml;

    // Override: if any blacklist hit, minimum score is 80
    if (features.phoneBlacklisted || features.emailBlacklisted || features.ipBlacklisted) {
      finalScore = Math.max(finalScore, 80);
    }

    // Clamp 0-100
    finalScore = Math.max(0, Math.min(100, Math.round(finalScore * 100) / 100));

    // Determine risk level and recommendation
    const riskLevel = this.getRiskLevel(finalScore);
    const recommendation = this.getRecommendation(finalScore);

    // Calculate confidence based on data availability
    const confidence = this.calculateConfidence(features, mlResult.confidence);

    // Generate recommendation reasons
    const { reasons, summary } = this.generateRecommendationReasons(
      recommendation,
      finalScore,
      ruleResult.signals,
      statResult.signals,
      mlResult.signals,
      mlResult.topFactors,
      features,
    );

    const durationMs = Date.now() - startTime;

    // Update phone record (fire and forget)
    this.updatePhoneRecord(features).catch(console.error);

    return {
      orderId: order.id,
      riskScore: finalScore,
      riskLevel,
      recommendation,
      signals: allSignals,
      recommendationReasons: reasons,
      riskSummary: summary,
      scoring: {
        ruleScore: ruleResult.score,
        statisticalScore: statResult.score,
        mlScore: mlResult.score,
      },
      confidence,
      modelVersion: mlResult.modelVersion,
      mlFeatures: mlResult.features,
      durationMs,
    };
  }

  private generateRecommendationReasons(
    recommendation: Recommendation,
    score: number,
    ruleSignals: RuleSignal[],
    statSignals: FraudSignal[],
    mlSignals: FraudSignal[],
    mlTopFactors: MLTopFactor[] | undefined,
    features: OrderFeatures,
  ): { reasons: string[]; summary: string } {
    const reasons: string[] = [];

    // Separate positive and negative signals
    const riskSignals = ruleSignals.filter(s => s.score > 0);
    const positiveSignals = ruleSignals.filter(s => s.score < 0);
    const statRiskSignals = statSignals.filter(s => s.score > 0);
    const statPositiveSignals = statSignals.filter(s => s.score < 0);

    if (recommendation === 'BLOCK') {
      // List top blocking signals sorted by severity/score
      const criticalRules = riskSignals
        .filter(s => s.severity === 'critical')
        .sort((a, b) => b.score - a.score);
      const highRules = riskSignals
        .filter(s => s.severity === 'high')
        .sort((a, b) => b.score - a.score);
      const otherRules = riskSignals
        .filter(s => s.severity !== 'critical' && s.severity !== 'high')
        .sort((a, b) => b.score - a.score);

      for (const s of criticalRules) reasons.push(s.description || s.signal);
      for (const s of highRules) reasons.push(s.description || s.signal);
      for (const s of otherRules.slice(0, 3)) reasons.push(s.description || s.signal);

      // Add stat signals
      for (const s of statRiskSignals.sort((a, b) => b.score - a.score).slice(0, 3)) {
        reasons.push(s.description || s.signal);
      }

      // Add ML top factors if available
      if (mlTopFactors) {
        for (const f of mlTopFactors.filter(f => f.direction === 'increases_risk').slice(0, 2)) {
          const label = ML_FEATURE_LABELS[f.feature] || f.feature;
          reasons.push(`ML: High ${label} (${f.value.toFixed(2)}) strongly increases risk`);
        }
      }

      // Build summary
      const topReason = criticalRules[0]?.description || highRules[0]?.description || 'Multiple high-risk signals detected';
      const summary = `Order blocked (score ${score.toFixed(0)}): ${topReason}`;
      return { reasons, summary };
    }

    if (recommendation === 'VERIFY') {
      // List concerning signals
      for (const s of riskSignals.sort((a, b) => b.score - a.score).slice(0, 4)) {
        reasons.push(s.description || s.signal);
      }
      for (const s of statRiskSignals.sort((a, b) => b.score - a.score).slice(0, 2)) {
        reasons.push(s.description || s.signal);
      }

      // Add mitigating factors
      for (const s of positiveSignals) {
        reasons.push(`[Positive] ${s.description || s.signal}`);
      }
      for (const s of statPositiveSignals) {
        reasons.push(`[Positive] ${s.description || s.signal}`);
      }

      // ML factors
      if (mlTopFactors) {
        for (const f of mlTopFactors.filter(f => f.direction === 'increases_risk').slice(0, 2)) {
          const label = ML_FEATURE_LABELS[f.feature] || f.feature;
          reasons.push(`ML: ${label} (${f.value.toFixed(2)}) increases risk`);
        }
      }

      // If no specific reasons found, add generic
      if (reasons.length === 0) {
        reasons.push('Moderate risk score requires manual verification');
      }

      // Add context-aware notes
      if (features.isCod && !features.isRepeatCustomer && features.isHighValue) {
        reasons.push('High value COD order from new customer requires verification');
      }

      const summary = `Verification needed (score ${score.toFixed(0)}): ${reasons[0]}`;
      return { reasons, summary };
    }

    // APPROVE
    // List positive factors
    if (features.isRepeatCustomer && features.customerRtoRate === 0) {
      reasons.push(`Repeat customer with ${features.previousOrderCount} successful orders`);
    }
    if (features.phoneValid && features.phoneMobile) {
      reasons.push(`Verified mobile phone number${features.phoneCarrier ? ` (${features.phoneCarrier})` : ''}`);
    }
    if (features.addressComplete) {
      reasons.push('Complete shipping address provided');
    }
    if (features.phoneOrderCount >= 3 && features.phoneRtoRate === 0) {
      reasons.push(`Phone has ${features.phoneOrderCount} orders with 0% RTO rate`);
    }

    for (const s of positiveSignals) {
      reasons.push(s.description || s.signal);
    }
    for (const s of statPositiveSignals) {
      reasons.push(s.description || s.signal);
    }

    // ML positive factors
    if (mlTopFactors) {
      for (const f of mlTopFactors.filter(f => f.direction === 'decreases_risk').slice(0, 2)) {
        const label = ML_FEATURE_LABELS[f.feature] || f.feature;
        reasons.push(`ML: ${label} reduces risk`);
      }
    }

    if (reasons.length === 0) {
      reasons.push('No significant risk signals detected');
    }

    const summary = `Order approved (score ${score.toFixed(0)}): ${reasons[0]}`;
    return { reasons, summary };
  }

  private async runRuleLayer(features: OrderFeatures) {
    return evaluateRules(features);
  }

  private async runStatisticalLayer(features: OrderFeatures) {
    return evaluateStatistical(features);
  }

  private async runMLLayer(features: OrderFeatures): Promise<{
    score: number;
    signals: FraudSignal[];
    confidence: number;
    modelVersion: string;
    topFactors?: MLTopFactor[];
    features?: Record<string, number>;
  }> {
    try {
      const prediction = await this.mlClient.predict(features);

      const signals: FraudSignal[] = [];
      if (prediction.score > 50) {
        signals.push({
          signal: 'ml_high_rto_probability',
          score: Math.round(prediction.score),
          layer: 'ml',
          description: `ML model predicts ${prediction.score.toFixed(1)}% RTO probability`,
        });
      }

      // Convert ML top factors to signals
      if (prediction.topFactors && prediction.topFactors.length > 0) {
        for (const factor of prediction.topFactors.slice(0, 5)) {
          const label = ML_FEATURE_LABELS[factor.feature] || factor.feature;
          const dir = factor.direction === 'increases_risk' ? 'increases' : 'decreases';
          signals.push({
            signal: `ml_factor_${factor.feature}`,
            score: Math.round(Math.abs(factor.impact) * 100),
            layer: 'ml',
            description: `ML: ${label} (${factor.value.toFixed(2)}) ${dir} risk`,
          });
        }
      }

      return {
        score: prediction.score,
        signals,
        confidence: prediction.confidence,
        modelVersion: prediction.modelVersion,
        topFactors: prediction.topFactors,
        features: prediction.features,
      };
    } catch (error) {
      // ML layer failure shouldn't block scoring
      return {
        score: 50, // neutral
        signals: [{
          signal: 'ml_unavailable',
          score: 0,
          layer: 'ml',
          description: 'ML service unavailable, using neutral score',
        }],
        confidence: 0,
        modelVersion: 'fallback',
      };
    }
  }

  private getRiskLevel(score: number): RiskLevel {
    if (score >= 80) return 'CRITICAL';
    if (score >= THRESHOLDS.block) return 'HIGH';
    if (score >= THRESHOLDS.verify) return 'MEDIUM';
    return 'LOW';
  }

  private getRecommendation(score: number): Recommendation {
    if (score >= THRESHOLDS.block) return 'BLOCK';
    if (score >= THRESHOLDS.verify) return 'VERIFY';
    return 'APPROVE';
  }

  private calculateConfidence(features: OrderFeatures, mlConfidence: number): number {
    let confidence = 0;

    // More data = more confidence
    if (features.phoneOrderCount >= 5) confidence += 0.25;
    else if (features.phoneOrderCount >= 2) confidence += 0.15;

    if (features.previousOrderCount >= 3) confidence += 0.20;
    else if (features.previousOrderCount >= 1) confidence += 0.10;

    if (features.addressOrderCount >= 3) confidence += 0.15;

    // ML confidence contributes
    confidence += mlConfidence * 0.40;

    return Math.min(confidence, 1.0);
  }

  private async updatePhoneRecord(features: OrderFeatures): Promise<void> {
    if (!features.normalizedPhone.isValid) return;

    const { query: dbQuery } = require('../../db/connection');
    await dbQuery(
      `INSERT INTO phones (phone_normalized, carrier, phone_type, total_orders, last_seen_at)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (phone_normalized)
       DO UPDATE SET
         total_orders = phones.total_orders + 1,
         last_seen_at = NOW(),
         carrier = COALESCE(EXCLUDED.carrier, phones.carrier)`,
      [
        features.normalizedPhone.normalized,
        features.normalizedPhone.carrier,
        features.normalizedPhone.isMobile ? 'mobile' : 'unknown',
      ]
    );
  }
}
