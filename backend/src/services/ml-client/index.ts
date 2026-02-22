import axios from 'axios';
import { config } from '../../config';
import { MLPrediction, MLTopFactor } from '../../types';
import { OrderFeatures } from '../fraud-engine/feature-extractor';
import { mlInferenceDuration, mlInferenceTotal } from '../metrics';
import { getRedis } from '../cache/redis';

const ML_TIMEOUT = 5000;

// Circuit breaker state
const CB = {
  state: 'closed' as 'closed' | 'open' | 'half-open',
  failures: 0,
  lastFailureMs: 0,
  THRESHOLD: 5,
  RESET_MS: 30_000,
};

function cbAllow(): boolean {
  if (CB.state === 'closed') return true;
  if (CB.state === 'open') {
    if (Date.now() - CB.lastFailureMs > CB.RESET_MS) {
      CB.state = 'half-open';
      return true;
    }
    return false;
  }
  return true; // half-open
}

function cbSuccess(): void {
  CB.failures = 0;
  CB.state = 'closed';
}

function cbFail(): void {
  CB.lastFailureMs = Date.now();
  if (++CB.failures >= CB.THRESHOLD) CB.state = 'open';
}

export class MLClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.ml.serviceUrl;
  }

  async predict(features: OrderFeatures): Promise<MLPrediction> {
    const startMs = Date.now();
    const mlFeatures = this.toMLFeatures(features);

    // Cache key: phone + amount bucket (30s TTL)
    const phone = features.normalizedPhone?.normalized || '';
    const amtBucket = Math.floor((mlFeatures.order_amount || 0) / 500) * 500;
    const cacheKey = phone ? `ml_pred_${phone}_${amtBucket}` : null;

    // Check cache first
    if (cacheKey) {
      try {
        const redis = await getRedis();
        const cached = await redis.get(cacheKey);
        if (cached) {
          return { ...JSON.parse(cached), fromCache: true };
        }
      } catch { /* Redis down = proceed without cache */ }
    }

    // Circuit breaker check
    if (!cbAllow()) {
      mlInferenceTotal.inc({ status: 'circuit_open' });
      return { score: 50, confidence: 0, modelVersion: 'circuit_open', features: {} };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/predict`,
        { features: mlFeatures },
        { timeout: ML_TIMEOUT }
      );

      cbSuccess();

      const durationMs = Date.now() - startMs;
      mlInferenceDuration.observe(
        { model_version: response.data.model_version || 'unknown', status: 'success' },
        durationMs
      );
      mlInferenceTotal.inc({ status: 'success' });

      let topFactors: MLTopFactor[] | undefined;
      if (response.data.top_factors && Array.isArray(response.data.top_factors)) {
        topFactors = response.data.top_factors.map((f: any) => ({
          feature: f.feature,
          value: f.value,
          impact: f.impact,
          direction: f.direction,
        }));
      }

      const result: MLPrediction = {
        score: response.data.rto_probability * 100,
        confidence: response.data.confidence,
        modelVersion: response.data.model_version,
        features: mlFeatures,
        topFactors,
      };

      // Cache the result
      if (cacheKey) {
        try {
          const redis = await getRedis();
          await redis.set(cacheKey, JSON.stringify(result), { EX: 30 });
        } catch { /* Non-fatal */ }
      }

      return result;
    } catch (error) {
      cbFail();
      const durationMs = Date.now() - startMs;
      mlInferenceDuration.observe({ model_version: 'fallback', status: 'failure' }, durationMs);
      mlInferenceTotal.inc({ status: 'fallback' });
      console.error('ML service prediction failed:', error);
      return {
        score: 50,
        confidence: 0,
        modelVersion: 'fallback',
        features: {},
      };
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, { timeout: 2000 });
      return response.data.status === 'healthy';
    } catch {
      return false;
    }
  }

  private toMLFeatures(f: OrderFeatures): Record<string, number> {
    const isCod = f.isCod ? 1 : 0;
    const isFirstOrder = f.previousOrderCount <= 0 ? 1 : 0;
    const isRepeat = f.isRepeatCustomer ? 1 : 0;
    const phoneVerified = f.phoneValid ? 1 : 0;
    const isHighValueOrder = f.isHighValue ? 1 : 0;

    return {
      order_amount: f.orderAmount,
      order_item_count: f.itemsCount,
      is_cod: isCod,
      is_prepaid: 1 - isCod,
      order_hour: f.orderHour,
      is_weekend: f.isWeekend ? 1 : 0,
      is_night_order: f.isNightOrder ? 1 : 0,

      customer_order_count: f.previousOrderCount,
      customer_rto_rate: f.customerRtoRate,
      customer_cancel_rate: 0,
      customer_avg_order_value: f.orderAmount,
      customer_account_age_days: f.phoneAgeInDays,
      customer_distinct_cities: f.phoneUniqueAddresses,
      customer_distinct_phones: 1,
      customer_address_changes: 0,

      city_rto_rate: f.cityRtoRate,
      city_order_volume: f.addressOrderCount,
      city_avg_delivery_days: 0,

      product_rto_rate: 0,
      product_category_rto_rate: 0,
      product_price_vs_avg: 1.0,

      is_high_value_order: isHighValueOrder,
      amount_zscore: 0,
      phone_verified: phoneVerified,
      email_verified: f.nameEmailMatch ? 1 : 0,
      address_quality_score: f.addressComplete ? (f.hasLandmark ? 0.9 : 0.7) : 0.3,
      shipping_distance_km: 0,
      same_city_shipping: 0,
      discount_percentage: 0,

      is_first_order: isFirstOrder,
      is_repeat_customer: isRepeat,
      days_since_last_order: f.daysSinceLastOrder,

      cod_first_order: isCod * isFirstOrder,
      high_value_cod_first: isHighValueOrder * isCod * isFirstOrder,
      phone_risk_score: f.customerRtoRate * (1 - phoneVerified),

      orders_last_24h: f.ordersLast24h,
      orders_last_7d: f.ordersLast7d,

      customer_lifetime_value: f.customerLifetimeValue,
      amount_vs_customer_avg: f.customerAvgOrderValue > 0
        ? f.orderAmount / f.customerAvgOrderValue
        : 1.0,

      is_new_account: f.phoneAgeInDays < 30 ? 1 : 0,
      new_account_high_value: (f.phoneAgeInDays < 30 && isHighValueOrder) ? 1 : 0,
      new_account_cod: (f.phoneAgeInDays < 30 && isCod) ? 1 : 0,

      orders_last_1h: f.ordersLast1h,
      is_eid_period: f.isEidPeriod ? 1 : 0,
      is_ramadan: f.isRamadan ? 1 : 0,
      is_sale_period: f.isSalePeriod ? 1 : 0,
      is_high_discount: f.isHighDiscount ? 1 : 0,
      avg_days_between_orders: f.avgDaysBetweenOrders,
    };
  }
}
