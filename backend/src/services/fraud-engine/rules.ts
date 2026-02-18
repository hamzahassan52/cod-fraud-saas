import { OrderFeatures } from './feature-extractor';
import { FraudSignal } from '../../types';

/**
 * Layer 1: Rule-Based Scoring
 * Deterministic rules based on Pakistan COD fraud patterns.
 */

export type RuleSeverity = 'critical' | 'high' | 'medium' | 'low' | 'positive';

interface Rule {
  name: string;
  description: (f: OrderFeatures) => string;
  severity: RuleSeverity;
  evaluate: (f: OrderFeatures) => number; // returns score 0-100
}

const RULES: Rule[] = [
  // ====== BLACKLIST RULES (Instant high score) ======
  {
    name: 'blacklisted_phone',
    description: (f) => `Phone ${f.normalizedPhone?.normalized || 'unknown'} is blacklisted`,
    severity: 'critical',
    evaluate: (f) => f.phoneBlacklisted ? 90 : 0,
  },
  {
    name: 'blacklisted_email',
    description: () => 'Email address is blacklisted',
    severity: 'critical',
    evaluate: (f) => f.emailBlacklisted ? 85 : 0,
  },
  {
    name: 'blacklisted_ip',
    description: () => 'IP address is blacklisted',
    severity: 'critical',
    evaluate: (f) => f.ipBlacklisted ? 80 : 0,
  },

  // ====== PHONE RULES ======
  {
    name: 'invalid_phone',
    description: (f) => !f.phoneValid
      ? 'Phone number is invalid or not recognized'
      : 'Phone number is not a mobile number (landline detected)',
    severity: 'medium',
    evaluate: (f) => !f.phoneValid ? 30 : (!f.phoneMobile ? 15 : 0),
  },
  {
    name: 'high_rto_phone',
    description: (f) => `Phone has ${(f.phoneRtoRate * 100).toFixed(0)}% RTO rate across ${f.phoneOrderCount} orders`,
    severity: 'high',
    evaluate: (f) => {
      if (f.phoneOrderCount < 3) return 0;
      if (f.phoneRtoRate > 0.7) return 45;
      if (f.phoneRtoRate > 0.5) return 30;
      if (f.phoneRtoRate > 0.3) return 15;
      return 0;
    },
  },
  {
    name: 'new_phone',
    description: () => 'First time seeing this phone number (no order history)',
    severity: 'low',
    evaluate: (f) => f.phoneOrderCount === 0 ? 10 : 0,
  },
  {
    name: 'phone_multiple_addresses',
    description: (f) => `Phone used at ${f.phoneUniqueAddresses} different delivery addresses`,
    severity: 'high',
    evaluate: (f) => {
      if (f.phoneUniqueAddresses > 5) return 25;
      if (f.phoneUniqueAddresses > 3) return 15;
      return 0;
    },
  },

  // ====== ADDRESS RULES ======
  {
    name: 'high_rto_address',
    description: (f) => `Delivery address has ${(f.addressRtoRate * 100).toFixed(0)}% RTO rate over ${f.addressOrderCount} orders`,
    severity: 'high',
    evaluate: (f) => {
      if (f.addressOrderCount < 3) return 0;
      if (f.addressRtoRate > 0.6) return 35;
      if (f.addressRtoRate > 0.4) return 20;
      return 0;
    },
  },
  {
    name: 'address_multiple_phones',
    description: (f) => `Address used by ${f.addressUniquePhones} different phone numbers`,
    severity: 'medium',
    evaluate: (f) => {
      if (f.addressUniquePhones > 5) return 20;
      if (f.addressUniquePhones > 3) return 10;
      return 0;
    },
  },
  {
    name: 'incomplete_address',
    description: () => 'Shipping address is incomplete (missing city, state, or zip)',
    severity: 'medium',
    evaluate: (f) => !f.addressComplete ? 15 : 0,
  },
  {
    name: 'short_address',
    description: (f) => `Address is suspiciously short (${f.addressLength} characters)`,
    severity: 'low',
    evaluate: (f) => f.addressLength < 20 ? 10 : 0,
  },
  {
    name: 'high_rto_city',
    description: (f) => `City has ${(f.cityRtoRate * 100).toFixed(0)}% overall RTO rate`,
    severity: 'medium',
    evaluate: (f) => {
      if (f.cityRtoRate > 0.5) return 20;
      if (f.cityRtoRate > 0.35) return 10;
      return 0;
    },
  },

  // ====== ORDER RULES ======
  {
    name: 'very_high_value_cod',
    description: (f) => `Very high value COD order: PKR ${f.orderAmount.toLocaleString()} (>25,000)`,
    severity: 'high',
    evaluate: (f) => f.isCod && f.isVeryHighValue ? 25 : 0,
  },
  {
    name: 'high_value_cod',
    description: (f) => `High value COD order: PKR ${f.orderAmount.toLocaleString()} (>10,000)`,
    severity: 'medium',
    evaluate: (f) => f.isCod && f.isHighValue && !f.isVeryHighValue ? 15 : 0,
  },
  {
    name: 'high_value_new_customer',
    description: (f) => `High value order (PKR ${f.orderAmount.toLocaleString()}) from first-time customer`,
    severity: 'high',
    evaluate: (f) => f.isHighValue && !f.isRepeatCustomer ? 20 : 0,
  },

  // ====== BEHAVIORAL RULES ======
  {
    name: 'night_order',
    description: (f) => `Order placed at ${f.orderHour}:00 (between midnight and 6 AM)`,
    severity: 'low',
    evaluate: (f) => f.isNightOrder ? 10 : 0,
  },
  {
    name: 'repeat_rto_customer',
    description: (f) => `Customer has ${f.previousRtoCount} previous RTO return(s) out of ${f.previousOrderCount} orders`,
    severity: 'high',
    evaluate: (f) => {
      if (f.previousRtoCount >= 3) return 40;
      if (f.previousRtoCount === 2) return 25;
      if (f.previousRtoCount === 1) return 15;
      return 0;
    },
  },
  {
    name: 'trusted_customer',
    description: (f) => `Repeat customer with ${f.previousOrderCount} successful orders and 0% RTO rate`,
    severity: 'positive',
    evaluate: (f) => {
      if (f.previousOrderCount >= 5 && f.customerRtoRate === 0) return -20;
      if (f.previousOrderCount >= 3 && f.customerRtoRate === 0) return -10;
      return 0;
    },
  },
  {
    name: 'name_short',
    description: (f) => `Customer name is only ${f.nameLength} characters (suspiciously short)`,
    severity: 'low',
    evaluate: (f) => f.nameLength < 4 ? 10 : 0,
  },
];

export interface RuleSignal extends FraudSignal {
  severity: RuleSeverity;
}

export function evaluateRules(features: OrderFeatures): {
  score: number;
  signals: RuleSignal[];
} {
  const signals: RuleSignal[] = [];
  let totalScore = 0;

  for (const rule of RULES) {
    const score = rule.evaluate(features);
    if (score !== 0) {
      signals.push({
        signal: rule.name,
        score,
        layer: 'rule',
        description: rule.description(features),
        severity: rule.severity,
      });
      totalScore += score;
    }
  }

  // Clamp to 0-100
  const finalScore = Math.max(0, Math.min(100, totalScore));

  return { score: finalScore, signals };
}
