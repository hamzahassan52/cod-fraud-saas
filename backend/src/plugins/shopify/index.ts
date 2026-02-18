import crypto from 'crypto';
import { NormalizedWebhookOrder, Platform, Address, LineItem } from '../../types';
import { PlatformPlugin, registry } from '../platform-plugin';

interface ShopifyAddress {
  first_name?: string;
  last_name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  province_code?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  phone?: string;
}

interface ShopifyLineItem {
  title?: string;
  name?: string;
  sku?: string;
  quantity?: number;
  price?: string | number;
}

interface ShopifyCustomer {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
}

interface ShopifyOrder {
  id?: number | string;
  order_number?: number | string;
  name?: string;
  email?: string;
  phone?: string;
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  line_items?: ShopifyLineItem[];
  customer?: ShopifyCustomer;
  total_price?: string | number;
  currency?: string;
  gateway?: string;
  payment_gateway_names?: string[];
  browser_ip?: string;
  user_agent?: string;
  note?: string;
  tags?: string;
  financial_status?: string;
  fulfillment_status?: string;
}

function safeString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function safeNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return isNaN(num) ? 0 : num;
}

function normalizeShopifyAddress(addr?: ShopifyAddress): Address {
  if (!addr) {
    return {};
  }
  return {
    address1: safeString(addr.address1),
    address2: safeString(addr.address2),
    city: safeString(addr.city),
    state: safeString(addr.province ?? addr.province_code),
    zip: safeString(addr.zip),
    country: safeString(addr.country_code ?? addr.country),
  };
}

function normalizeShopifyLineItems(items?: ShopifyLineItem[]): LineItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    name: String(item.title ?? item.name ?? 'Unknown Item'),
    sku: safeString(item.sku),
    quantity: Math.max(0, Math.round(safeNumber(item.quantity))),
    price: safeNumber(item.price),
  }));
}

function resolvePaymentMethod(order: ShopifyOrder): string {
  if (order.gateway) return String(order.gateway);
  if (Array.isArray(order.payment_gateway_names) && order.payment_gateway_names.length > 0) {
    return String(order.payment_gateway_names[0]);
  }
  return 'unknown';
}

function buildCustomerName(order: ShopifyOrder): string | undefined {
  // Prefer customer object, fall back to shipping address
  const customer = order.customer;
  if (customer?.first_name || customer?.last_name) {
    return [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim() || undefined;
  }
  const addr = order.shipping_address ?? order.billing_address;
  if (addr?.first_name || addr?.last_name) {
    return [addr.first_name, addr.last_name].filter(Boolean).join(' ').trim() || undefined;
  }
  return undefined;
}

function resolveCustomerPhone(order: ShopifyOrder): string | undefined {
  return safeString(
    order.phone ??
    order.customer?.phone ??
    order.shipping_address?.phone ??
    order.billing_address?.phone
  );
}

function resolveCustomerEmail(order: ShopifyOrder): string | undefined {
  return safeString(order.email ?? order.customer?.email);
}

const shopifyPlugin: PlatformPlugin = {
  name: 'shopify' as Platform,

  validateWebhook(headers: Record<string, string>, body: string, secret: string): boolean {
    // Shopify sends HMAC as base64-encoded SHA-256
    // Header key may be lowercase due to HTTP normalization
    const headerKey = 'x-shopify-hmac-sha256';
    const hmacHeader = headers[headerKey]
      ?? headers['X-Shopify-Hmac-Sha256']
      ?? headers['X-Shopify-Hmac-SHA256'];

    if (!hmacHeader || !secret || !body) {
      return false;
    }

    try {
      const computed = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('base64');

      // Constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(hmacHeader, 'utf8'),
        Buffer.from(computed, 'utf8'),
      );
    } catch {
      return false;
    }
  },

  normalizeOrder(rawPayload: unknown): NormalizedWebhookOrder {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('Shopify plugin: rawPayload must be a non-null object');
    }

    const order = rawPayload as ShopifyOrder;
    const externalOrderId = String(order.id ?? order.order_number ?? order.name ?? '');

    if (!externalOrderId) {
      throw new Error('Shopify plugin: order must have an id, order_number, or name');
    }

    const lineItems = normalizeShopifyLineItems(order.line_items);
    const itemsCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);

    return {
      externalOrderId,
      platform: 'shopify',
      customerName: buildCustomerName(order),
      customerEmail: resolveCustomerEmail(order),
      customerPhone: resolveCustomerPhone(order),
      shippingAddress: normalizeShopifyAddress(order.shipping_address ?? order.billing_address),
      totalAmount: safeNumber(order.total_price),
      currency: String(order.currency ?? 'USD').toUpperCase(),
      itemsCount,
      lineItems,
      paymentMethod: resolvePaymentMethod(order),
      ipAddress: safeString(order.browser_ip),
      userAgent: undefined, // Shopify does not send user_agent in the order payload
      platformData: {
        financialStatus: order.financial_status,
        fulfillmentStatus: order.fulfillment_status,
        tags: order.tags,
        note: order.note,
        orderName: order.name,
      },
    };
  },
};

registry.register(shopifyPlugin);

export default shopifyPlugin;
