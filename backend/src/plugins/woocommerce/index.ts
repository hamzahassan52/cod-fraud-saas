import crypto from 'crypto';
import { NormalizedWebhookOrder, Platform, Address, LineItem } from '../../types';
import { PlatformPlugin, registry } from '../platform-plugin';

interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

interface WooLineItem {
  name?: string;
  sku?: string;
  quantity?: number;
  price?: number | string;
  total?: string | number;
  product_id?: number;
}

interface WooOrder {
  id?: number | string;
  number?: string | number;
  order_key?: string;
  billing?: WooAddress;
  shipping?: WooAddress;
  line_items?: WooLineItem[];
  total?: string | number;
  currency?: string;
  payment_method?: string;
  payment_method_title?: string;
  customer_ip_address?: string;
  customer_user_agent?: string;
  customer_note?: string;
  status?: string;
  date_created?: string;
  meta_data?: Array<{ key: string; value: unknown }>;
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

function normalizeWooAddress(addr?: WooAddress): Address {
  if (!addr) return {};
  return {
    address1: safeString(addr.address_1),
    address2: safeString(addr.address_2),
    city: safeString(addr.city),
    state: safeString(addr.state),
    zip: safeString(addr.postcode),
    country: safeString(addr.country),
  };
}

function normalizeWooLineItems(items?: WooLineItem[]): LineItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    name: String(item.name ?? 'Unknown Item'),
    sku: safeString(item.sku),
    quantity: Math.max(0, Math.round(safeNumber(item.quantity))),
    price: safeNumber(item.price ?? item.total),
  }));
}

function buildCustomerName(order: WooOrder): string | undefined {
  const billing = order.billing;
  const shipping = order.shipping;
  const source = billing ?? shipping;
  if (!source) return undefined;
  const parts = [source.first_name, source.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ').trim() : undefined;
}

function resolveCustomerEmail(order: WooOrder): string | undefined {
  return safeString(order.billing?.email);
}

function resolveCustomerPhone(order: WooOrder): string | undefined {
  return safeString(order.billing?.phone ?? order.shipping?.phone);
}

const woocommercePlugin: PlatformPlugin = {
  name: 'woocommerce' as Platform,

  validateWebhook(headers: Record<string, string>, body: string, secret: string): boolean {
    // WooCommerce sends the signature as base64-encoded HMAC-SHA256
    const headerKey = 'x-wc-webhook-signature';
    const signatureHeader = headers[headerKey]
      ?? headers['X-WC-Webhook-Signature']
      ?? headers['X-Wc-Webhook-Signature'];

    if (!signatureHeader || !secret || !body) {
      return false;
    }

    try {
      const computed = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest('base64');

      // Constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signatureHeader, 'utf8'),
        Buffer.from(computed, 'utf8'),
      );
    } catch {
      return false;
    }
  },

  normalizeOrder(rawPayload: unknown): NormalizedWebhookOrder {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('WooCommerce plugin: rawPayload must be a non-null object');
    }

    const order = rawPayload as WooOrder;
    const externalOrderId = String(order.id ?? order.number ?? order.order_key ?? '');

    if (!externalOrderId) {
      throw new Error('WooCommerce plugin: order must have an id, number, or order_key');
    }

    const lineItems = normalizeWooLineItems(order.line_items);
    const itemsCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);

    return {
      externalOrderId,
      platform: 'woocommerce',
      customerName: buildCustomerName(order),
      customerEmail: resolveCustomerEmail(order),
      customerPhone: resolveCustomerPhone(order),
      shippingAddress: normalizeWooAddress(order.shipping ?? order.billing),
      totalAmount: safeNumber(order.total),
      currency: String(order.currency ?? 'USD').toUpperCase(),
      itemsCount,
      lineItems,
      paymentMethod: String(order.payment_method ?? order.payment_method_title ?? 'unknown'),
      ipAddress: safeString(order.customer_ip_address),
      userAgent: safeString(order.customer_user_agent),
      platformData: {
        status: order.status,
        paymentMethodTitle: order.payment_method_title,
        customerNote: order.customer_note,
        dateCreated: order.date_created,
        orderKey: order.order_key,
      },
    };
  },
};

registry.register(woocommercePlugin);

export default woocommercePlugin;
