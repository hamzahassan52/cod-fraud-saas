import { OrderFeatures } from './feature-extractor';
import { FraudSignal } from '../../types';

/**
 * Layer 2: Statistical Scoring
 * Uses historical aggregates and statistical models to assess risk.
 */

// City-level risk tiers (Pakistan specific - based on RTO data patterns)
const HIGH_RTO_CITIES: Set<string> = new Set([
  // These would be populated from actual data analysis
  // Placeholder known high-RTO areas
]);

// Time decay: more weight to recent orders
function timeDecayWeight(daysSinceLast: number): number {
  if (daysSinceLast <= 7) return 1.0;
  if (daysSinceLast <= 30) return 0.8;
  if (daysSinceLast <= 90) return 0.5;
  return 0.3;
}

interface StatisticalResult {
  score: number;
  signals: FraudSignal[];
}

export function evaluateStatistical(features: OrderFeatures): StatisticalResult {
  const signals: FraudSignal[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  // --- Phone RTO probability ---
  if (features.phoneOrderCount >= 3) {
    const phoneWeight = Math.min(features.phoneOrderCount / 10, 1.0) * 0.3;
    const phoneScore = features.phoneRtoRate * 100;
    weightedScore += phoneScore * phoneWeight;
    totalWeight += phoneWeight;

    if (phoneScore > 30) {
      signals.push({
        signal: 'stat_phone_rto_probability',
        score: Math.round(phoneScore * phoneWeight),
        layer: 'statistical',
        description: `Phone RTO rate: ${(features.phoneRtoRate * 100).toFixed(1)}% over ${features.phoneOrderCount} orders`,
      });
    }
  }

  // --- Address RTO probability ---
  if (features.addressOrderCount >= 3) {
    const addrWeight = Math.min(features.addressOrderCount / 20, 1.0) * 0.2;
    const addrScore = features.addressRtoRate * 100;
    weightedScore += addrScore * addrWeight;
    totalWeight += addrWeight;

    if (addrScore > 25) {
      signals.push({
        signal: 'stat_address_rto_probability',
        score: Math.round(addrScore * addrWeight),
        layer: 'statistical',
        description: `Address RTO rate: ${(features.addressRtoRate * 100).toFixed(1)}%`,
      });
    }
  }

  // --- Customer history score ---
  if (features.previousOrderCount >= 2) {
    const custWeight = 0.25;
    const decay = timeDecayWeight(features.daysSinceLastOrder);
    const custScore = features.customerRtoRate * 100 * decay;
    weightedScore += custScore * custWeight;
    totalWeight += custWeight;

    if (features.customerRtoRate > 0.3) {
      signals.push({
        signal: 'stat_customer_rto_history',
        score: Math.round(custScore * custWeight),
        layer: 'statistical',
        description: `Customer RTO rate: ${(features.customerRtoRate * 100).toFixed(1)}% with decay factor ${decay}`,
      });
    }
    if (features.customerRtoRate === 0 && features.previousOrderCount >= 3) {
      signals.push({
        signal: 'stat_trusted_customer',
        score: -15,
        layer: 'statistical',
        description: `Customer has ${features.previousOrderCount} orders with 0% RTO`,
      });
      weightedScore -= 15;
    }
  }

  // --- City-level risk ---
  if (features.cityRtoRate > 0.2) {
    const cityWeight = 0.15;
    const cityScore = features.cityRtoRate * 100;
    weightedScore += cityScore * cityWeight;
    totalWeight += cityWeight;

    signals.push({
      signal: 'stat_high_rto_city',
      score: Math.round(cityScore * cityWeight),
      layer: 'statistical',
      description: `City RTO rate: ${(features.cityRtoRate * 100).toFixed(1)}%`,
    });
  }

  // --- Amount anomaly ---
  // High COD amounts with no history = risk
  if (features.isCod && !features.isRepeatCustomer) {
    const amountWeight = 0.1;
    let amountScore = 0;
    if (features.orderAmount > 50000) amountScore = 40;
    else if (features.orderAmount > 25000) amountScore = 25;
    else if (features.orderAmount > 10000) amountScore = 15;

    if (amountScore > 0) {
      weightedScore += amountScore * amountWeight;
      totalWeight += amountWeight;
      signals.push({
        signal: 'stat_high_cod_new_customer',
        score: Math.round(amountScore * amountWeight),
        layer: 'statistical',
        description: `COD order of ${features.orderAmount} PKR from new customer`,
      });
    }
  }

  // --- Velocity check: multiple phones per address ---
  if (features.addressUniquePhones > 3) {
    const velScore = Math.min((features.addressUniquePhones - 3) * 5, 25);
    signals.push({
      signal: 'stat_address_phone_velocity',
      score: velScore,
      layer: 'statistical',
      description: `${features.addressUniquePhones} different phones used at this address`,
    });
    weightedScore += velScore;
  }

  // Normalize
  const finalScore = Math.max(0, Math.min(100, Math.round(
    totalWeight > 0 ? weightedScore / Math.max(totalWeight, 0.5) : weightedScore
  )));

  return { score: finalScore, signals };
}
