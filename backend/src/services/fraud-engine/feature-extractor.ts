import { query } from '../../db/connection';
import { normalizePhone, NormalizedPhone } from '../phone-normalizer';
import { cacheGetOrSet } from '../cache/redis';

/**
 * Feature Extractor
 * Extracts fraud-relevant features from order data for scoring layers.
 */

export interface OrderFeatures {
  // Phone features
  phoneValid: boolean;
  phoneMobile: boolean;
  phoneCarrier: string | null;
  phoneOrderCount: number;
  phoneRtoCount: number;
  phoneRtoRate: number;
  phoneIsBlacklisted: boolean;
  phoneAgeInDays: number;
  phoneUniqueAddresses: number;

  // Address features
  addressOrderCount: number;
  addressRtoCount: number;
  addressRtoRate: number;
  addressUniquePhones: number;
  addressUniqueNames: number;
  cityRtoRate: number;

  // Order features
  orderAmount: number;
  itemsCount: number;
  avgItemPrice: number;
  isCod: boolean;
  isHighValue: boolean; // > 10000 PKR
  isVeryHighValue: boolean; // > 25000 PKR

  // Customer features
  isRepeatCustomer: boolean;
  previousOrderCount: number;
  previousRtoCount: number;
  customerRtoRate: number;
  daysSinceLastOrder: number;

  // Behavioral features
  orderHour: number;
  isNightOrder: boolean; // 12am - 6am
  isWeekend: boolean;
  nameEmailMatch: boolean;
  addressComplete: boolean;
  hasLandmark: boolean;
  addressLength: number;
  nameLength: number;

  // Blacklist features
  phoneBlacklisted: boolean;
  emailBlacklisted: boolean;
  addressBlacklisted: boolean;
  ipBlacklisted: boolean;

  // Normalized phone
  normalizedPhone: NormalizedPhone;
}

export class FeatureExtractor {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  async extract(order: Record<string, any>): Promise<OrderFeatures> {
    const phone = normalizePhone(order.customer_phone || '');

    const [phoneRecord, addressStats, customerHistory, blacklists, cityStats] =
      await Promise.all([
        this.getPhoneRecord(phone.normalized),
        this.getAddressStats(order),
        this.getCustomerHistory(phone.normalized, order.customer_email),
        this.checkBlacklists(phone.normalized, order.customer_email, order.ip_address),
        this.getCityRtoRate(order.shipping_city),
      ]);

    const now = new Date();
    const orderDate = new Date(order.created_at || now);
    const hour = orderDate.getHours();
    const isWeekend = orderDate.getDay() === 0 || orderDate.getDay() === 6;
    const amount = parseFloat(order.total_amount) || 0;
    const itemsCount = order.items_count || 0;

    return {
      // Phone
      phoneValid: phone.isValid,
      phoneMobile: phone.isMobile,
      phoneCarrier: phone.carrier,
      phoneOrderCount: phoneRecord.totalOrders,
      phoneRtoCount: phoneRecord.totalRto,
      phoneRtoRate: phoneRecord.rtoRate,
      phoneIsBlacklisted: phoneRecord.isBlacklisted,
      phoneAgeInDays: phoneRecord.ageInDays,
      phoneUniqueAddresses: phoneRecord.uniqueAddresses,

      // Address
      addressOrderCount: addressStats.totalOrders,
      addressRtoCount: addressStats.totalRto,
      addressRtoRate: addressStats.rtoRate,
      addressUniquePhones: addressStats.uniquePhones,
      addressUniqueNames: addressStats.uniqueNames,
      cityRtoRate: cityStats,

      // Order
      orderAmount: amount,
      itemsCount,
      avgItemPrice: itemsCount > 0 ? amount / itemsCount : amount,
      isCod: (order.payment_method || '').toLowerCase() === 'cod',
      isHighValue: amount > 10000,
      isVeryHighValue: amount > 25000,

      // Customer
      isRepeatCustomer: customerHistory.orderCount > 0,
      previousOrderCount: customerHistory.orderCount,
      previousRtoCount: customerHistory.rtoCount,
      customerRtoRate: customerHistory.rtoRate,
      daysSinceLastOrder: customerHistory.daysSinceLast,

      // Behavioral
      orderHour: hour,
      isNightOrder: hour >= 0 && hour < 6,
      isWeekend,
      nameEmailMatch: this.checkNameEmailMatch(order.customer_name, order.customer_email),
      addressComplete: this.isAddressComplete(order.shipping_address),
      hasLandmark: this.hasLandmark(order.shipping_address),
      addressLength: JSON.stringify(order.shipping_address || {}).length,
      nameLength: (order.customer_name || '').length,

      // Blacklists
      phoneBlacklisted: blacklists.phone,
      emailBlacklisted: blacklists.email,
      addressBlacklisted: blacklists.address,
      ipBlacklisted: blacklists.ip,

      normalizedPhone: phone,
    };
  }

  private async getPhoneRecord(normalized: string) {
    if (!normalized) {
      return { totalOrders: 0, totalRto: 0, rtoRate: 0, isBlacklisted: false, ageInDays: 0, uniqueAddresses: 0 };
    }

    return cacheGetOrSet(`phone:${normalized}`, async () => {
      const result = await query(
        `SELECT total_orders, total_rto, rto_rate, is_blacklisted,
                EXTRACT(DAY FROM NOW() - first_seen_at) as age_days
         FROM phones WHERE phone_normalized = $1`,
        [normalized]
      );

      if (result.rows.length === 0) {
        return { totalOrders: 0, totalRto: 0, rtoRate: 0, isBlacklisted: false, ageInDays: 0, uniqueAddresses: 0 };
      }

      const row = result.rows[0];
      const addrResult = await query(
        `SELECT COUNT(DISTINCT shipping_city) as unique_addr FROM orders WHERE phone_normalized = $1`,
        [normalized]
      );

      return {
        totalOrders: row.total_orders,
        totalRto: row.total_rto,
        rtoRate: parseFloat(row.rto_rate) || 0,
        isBlacklisted: row.is_blacklisted,
        ageInDays: parseFloat(row.age_days) || 0,
        uniqueAddresses: parseInt(addrResult.rows[0]?.unique_addr || '0'),
      };
    }, 120);
  }

  private async getAddressStats(order: Record<string, any>) {
    const city = order.shipping_city;
    if (!city) {
      return { totalOrders: 0, totalRto: 0, rtoRate: 0, uniquePhones: 0, uniqueNames: 0 };
    }

    return cacheGetOrSet(`addr:${this.tenantId}:${city}`, async () => {
      const result = await query(
        `SELECT
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE status = 'rto') as total_rto,
          COUNT(DISTINCT phone_normalized) as unique_phones,
          COUNT(DISTINCT customer_name) as unique_names
         FROM orders WHERE tenant_id = $1 AND shipping_city = $2`,
        [this.tenantId, city]
      );
      const row = result.rows[0];
      const total = parseInt(row.total_orders) || 0;
      const rto = parseInt(row.total_rto) || 0;
      return {
        totalOrders: total,
        totalRto: rto,
        rtoRate: total > 0 ? rto / total : 0,
        uniquePhones: parseInt(row.unique_phones) || 0,
        uniqueNames: parseInt(row.unique_names) || 0,
      };
    }, 300);
  }

  private async getCustomerHistory(phone: string, email: string) {
    const result = await query(
      `SELECT
        COUNT(*) as order_count,
        COUNT(*) FILTER (WHERE status = 'rto') as rto_count,
        MAX(created_at) as last_order
       FROM orders
       WHERE tenant_id = $1 AND (phone_normalized = $2 OR customer_email = $3)`,
      [this.tenantId, phone, email]
    );
    const row = result.rows[0];
    const orderCount = parseInt(row.order_count) || 0;
    const rtoCount = parseInt(row.rto_count) || 0;
    const lastOrder = row.last_order ? new Date(row.last_order) : null;
    const daysSinceLast = lastOrder
      ? Math.floor((Date.now() - lastOrder.getTime()) / 86400000)
      : 999;

    return {
      orderCount,
      rtoCount,
      rtoRate: orderCount > 0 ? rtoCount / orderCount : 0,
      daysSinceLast,
    };
  }

  private async checkBlacklists(phone: string, email: string, ip: string) {
    const result = await query(
      `SELECT type, value_normalized FROM blacklist
       WHERE (tenant_id = $1 OR is_global = true)
         AND ((type = 'phone' AND value_normalized = $2)
           OR (type = 'email' AND value_normalized = $3)
           OR (type = 'ip' AND value_normalized = $4))
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.tenantId, phone, (email || '').toLowerCase(), ip]
    );

    const types = new Set(result.rows.map((r: any) => r.type));
    return {
      phone: types.has('phone'),
      email: types.has('email'),
      address: false,
      ip: types.has('ip'),
    };
  }

  private async getCityRtoRate(city: string): Promise<number> {
    if (!city) return 0;
    return cacheGetOrSet(`city_rto:${city}`, async () => {
      const result = await query(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'rto') as rto
         FROM orders WHERE shipping_city = $1`,
        [city]
      );
      const total = parseInt(result.rows[0].total) || 0;
      const rto = parseInt(result.rows[0].rto) || 0;
      return total > 10 ? rto / total : 0;
    }, 600);
  }

  private checkNameEmailMatch(name: string, email: string): boolean {
    if (!name || !email) return false;
    const nameParts = name.toLowerCase().split(/\s+/);
    const emailLocal = email.split('@')[0].toLowerCase();
    return nameParts.some((part) => emailLocal.includes(part));
  }

  private isAddressComplete(address: any): boolean {
    if (!address) return false;
    const addr = typeof address === 'string' ? { address1: address } : address;
    return !!(addr.address1 && addr.city);
  }

  private hasLandmark(address: any): boolean {
    if (!address) return false;
    const text = typeof address === 'string' ? address : JSON.stringify(address);
    const landmarks = ['near', 'opposite', 'beside', 'behind', 'next to', 'samne', 'ke paas', 'qareeb'];
    return landmarks.some((l) => text.toLowerCase().includes(l));
  }
}
