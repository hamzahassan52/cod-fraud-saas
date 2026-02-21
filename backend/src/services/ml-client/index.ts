import axios from 'axios';
import { config } from '../../config';
import { MLPrediction, MLTopFactor } from '../../types';
import { OrderFeatures } from '../fraud-engine/feature-extractor';
import { mlInferenceDuration, mlInferenceTotal } from '../metrics';

/**
 * ML Service Client
 * Communicates with the Python FastAPI ML microservice.
 */

const ML_TIMEOUT = 5000; // 5 second timeout

export class MLClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = config.ml.serviceUrl;
  }

  async predict(features: OrderFeatures): Promise<MLPrediction> {
    const startMs = Date.now();
    try {
      const mlFeatures = this.toMLFeatures(features);

      const response = await axios.post(
        `${this.baseUrl}/predict`,
        { features: mlFeatures },
        { timeout: ML_TIMEOUT }
      );

      const durationMs = Date.now() - startMs;
      mlInferenceDuration.observe(
        { model_version: response.data.model_version || 'unknown', status: 'success' },
        durationMs
      );
      mlInferenceTotal.inc({ status: 'success' });

      // Parse top_factors from ML response
      let topFactors: MLTopFactor[] | undefined;
      if (response.data.top_factors && Array.isArray(response.data.top_factors)) {
        topFactors = response.data.top_factors.map((f: any) => ({
          feature: f.feature,
          value: f.value,
          impact: f.impact,
          direction: f.direction,
        }));
      }

      return {
        score: response.data.rto_probability * 100,
        confidence: response.data.confidence,
        modelVersion: response.data.model_version,
        features: mlFeatures,
        topFactors,
      };
    } catch (error) {
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

  /**
   * Convert OrderFeatures to flat numeric dict matching the ML model's 35 expected feature names.
   *
   * The ML model (XGBoost) was trained with a specific set of 35 feature names.
   * This mapping bridges the backend FeatureExtractor field names to those exact names.
   * Any feature the backend cannot directly compute is filled with a sensible default.
   */
  private toMLFeatures(f: OrderFeatures): Record<string, number> {
    const isCod = f.isCod ? 1 : 0;
    const isFirstOrder = f.previousOrderCount <= 0 ? 1 : 0;
    const isRepeat = f.isRepeatCustomer ? 1 : 0;
    const phoneVerified = f.phoneValid ? 1 : 0;
    const isHighValueOrder = f.isHighValue ? 1 : 0;

    return {
      // Order features
      order_amount: f.orderAmount,
      order_item_count: f.itemsCount,
      is_cod: isCod,
      is_prepaid: 1 - isCod,
      order_hour: f.orderHour,
      is_weekend: f.isWeekend ? 1 : 0,
      is_night_order: f.isNightOrder ? 1 : 0,

      // Customer features
      customer_order_count: f.previousOrderCount,
      customer_rto_rate: f.customerRtoRate,
      customer_cancel_rate: 0, // not tracked in backend yet
      customer_avg_order_value: f.orderAmount, // approximate with current order
      customer_account_age_days: f.phoneAgeInDays,
      customer_distinct_cities: f.phoneUniqueAddresses,
      customer_distinct_phones: 1, // single phone per request
      customer_address_changes: 0, // not tracked in backend yet

      // City features
      city_rto_rate: f.cityRtoRate,
      city_order_volume: f.addressOrderCount,
      city_avg_delivery_days: 0, // not tracked in backend yet

      // Product features
      product_rto_rate: 0, // not tracked per-product yet
      product_category_rto_rate: 0, // not tracked per-category yet
      product_price_vs_avg: 1.0, // neutral default

      // Derived features
      is_high_value_order: isHighValueOrder,
      amount_zscore: 0, // requires population stats, default to mean
      phone_verified: phoneVerified,
      email_verified: f.nameEmailMatch ? 1 : 0, // best proxy available
      address_quality_score: f.addressComplete ? (f.hasLandmark ? 0.9 : 0.7) : 0.3,
      shipping_distance_km: 0, // not tracked in backend yet
      same_city_shipping: 0, // not tracked in backend yet
      discount_percentage: 0, // not tracked in backend yet

      // Customer lifecycle
      is_first_order: isFirstOrder,
      is_repeat_customer: isRepeat,
      days_since_last_order: f.daysSinceLastOrder,

      // Interaction features
      cod_first_order: isCod * isFirstOrder,
      high_value_cod_first: isHighValueOrder * isCod * isFirstOrder,
      phone_risk_score: f.customerRtoRate * (1 - phoneVerified),

      // Velocity features (v2)
      orders_last_24h: f.ordersLast24h,
      orders_last_7d:  f.ordersLast7d,

      // Value anomaly (v2)
      customer_lifetime_value: f.customerLifetimeValue,
      amount_vs_customer_avg: f.customerAvgOrderValue > 0
        ? f.orderAmount / f.customerAvgOrderValue
        : 1.0,

      // New account signals (v2)
      is_new_account:        f.phoneAgeInDays < 30 ? 1 : 0,
      new_account_high_value: (f.phoneAgeInDays < 30 && isHighValueOrder) ? 1 : 0,
      new_account_cod:        (f.phoneAgeInDays < 30 && isCod)            ? 1 : 0,

      // Seasonal + behavioral + discount signals (v3)
      orders_last_1h:         f.ordersLast1h,
      is_eid_period:          f.isEidPeriod ? 1 : 0,
      is_ramadan:             f.isRamadan ? 1 : 0,
      is_sale_period:         f.isSalePeriod ? 1 : 0,
      is_high_discount:       f.isHighDiscount ? 1 : 0,
      avg_days_between_orders: f.avgDaysBetweenOrders,
    };
  }
}
