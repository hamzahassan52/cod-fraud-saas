import crypto from 'crypto';
import { NormalizedWebhookOrder, Platform, Address, LineItem } from '../../types';
import { PlatformPlugin, registry } from '../platform-plugin';

// VirtueMart (Joomla's primary e-commerce extension) types

interface VirtueMartAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  virtuemart_state_id?: string;
  state_name?: string;
  zip?: string;
  virtuemart_country_id?: string;
  country_name?: string;
  country_code?: string;
  phone_1?: string;
  phone_2?: string;
}

interface VirtueMartItem {
  order_item_name?: string;
  order_item_sku?: string;
  product_quantity?: number | string;
  product_item_price?: number | string;
  product_final_price?: number | string;
  product_priceWithoutTax?: number | string;
}

interface VirtueMartUserInfo {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_1?: string;
  phone_2?: string;
}

interface VirtueMartOrder {
  virtuemart_order_id?: number | string;
  order_number?: string;
  order_total?: number | string;
  order_currency?: string;
  order_currency_code?: string;
  order_status?: string;
  order_status_name?: string;
  payment_method?: string;
  payment_name?: string;
  virtuemart_paymentmethod_id?: number | string;
  ip_address?: string;
  customer_ip?: string;
  created_on?: string;
  order_items?: VirtueMartItem[];
  items?: VirtueMartItem[];
  // VirtueMart may nest user/address info differently
  user_info?: VirtueMartUserInfo;
  bill_to?: VirtueMartAddress;
  ship_to?: VirtueMartAddress;
  // Alternative flat structure
  billing?: VirtueMartAddress;
  shipping?: VirtueMartAddress;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
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

function normalizeVmAddress(addr?: VirtueMartAddress): Address {
  if (!addr) return {};
  return {
    address1: safeString(addr.address_1),
    address2: safeString(addr.address_2),
    city: safeString(addr.city),
    state: safeString(addr.state_name ?? addr.virtuemart_state_id),
    zip: safeString(addr.zip),
    country: safeString(addr.country_code ?? addr.country_name ?? addr.virtuemart_country_id),
  };
}

function normalizeVmLineItems(order: VirtueMartOrder): LineItem[] {
  const items = order.order_items ?? order.items;
  if (!Array.isArray(items)) return [];

  return items.map((item) => ({
    name: String(item.order_item_name ?? 'Unknown Item'),
    sku: safeString(item.order_item_sku),
    quantity: Math.max(0, Math.round(safeNumber(item.product_quantity))),
    price: safeNumber(item.product_final_price ?? item.product_item_price ?? item.product_priceWithoutTax),
  }));
}

function resolveShippingAddress(order: VirtueMartOrder): VirtueMartAddress | undefined {
  return order.ship_to ?? order.shipping ?? order.bill_to ?? order.billing;
}

function buildCustomerName(order: VirtueMartOrder): string | undefined {
  if (order.customer_name) return order.customer_name;

  const userInfo = order.user_info;
  if (userInfo?.first_name || userInfo?.last_name) {
    return [userInfo.first_name, userInfo.last_name].filter(Boolean).join(' ').trim() || undefined;
  }

  const billing = order.bill_to ?? order.billing;
  if (billing?.first_name || billing?.last_name) {
    return [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || undefined;
  }

  return undefined;
}

function resolveCustomerEmail(order: VirtueMartOrder): string | undefined {
  return safeString(order.customer_email ?? order.user_info?.email);
}

function resolveCustomerPhone(order: VirtueMartOrder): string | undefined {
  return safeString(
    order.customer_phone ??
    order.user_info?.phone_1 ??
    order.user_info?.phone_2 ??
    order.ship_to?.phone_1 ??
    order.bill_to?.phone_1
  );
}

function resolvePaymentMethod(order: VirtueMartOrder): string {
  if (order.payment_method) return String(order.payment_method);
  if (order.payment_name) return String(order.payment_name);
  if (order.virtuemart_paymentmethod_id) return String(order.virtuemart_paymentmethod_id);
  return 'unknown';
}

const joomlaPlugin: PlatformPlugin = {
  name: 'joomla' as Platform,

  validateWebhook(headers: Record<string, string>, body: string, secret: string): boolean {
    // Joomla/VirtueMart uses a basic HMAC-SHA256 signature
    // Check multiple possible header names for flexibility
    const signatureHeader =
      headers['x-vm-webhook-signature'] ??
      headers['X-VM-Webhook-Signature'] ??
      headers['x-joomla-signature'] ??
      headers['X-Joomla-Signature'] ??
      headers['x-webhook-signature'] ??
      headers['X-Webhook-Signature'];

    if (!signatureHeader || !secret || !body) {
      return false;
    }

    try {
      // Support both hex and base64 signatures by detecting format
      const isBase64 = /^[A-Za-z0-9+/]+=*$/.test(signatureHeader) && !(/^[0-9a-f]+$/i.test(signatureHeader));

      const encoding: crypto.BinaryToTextEncoding = isBase64 ? 'base64' : 'hex';
      const computed = crypto
        .createHmac('sha256', secret)
        .update(body, 'utf8')
        .digest(encoding);

      // Constant-time comparison to prevent timing attacks
      const headerBuf = Buffer.from(signatureHeader, 'utf8');
      const computedBuf = Buffer.from(computed, 'utf8');

      if (headerBuf.length !== computedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(headerBuf, computedBuf);
    } catch {
      return false;
    }
  },

  normalizeOrder(rawPayload: unknown): NormalizedWebhookOrder {
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('Joomla plugin: rawPayload must be a non-null object');
    }

    const order = rawPayload as VirtueMartOrder;
    const externalOrderId = String(
      order.order_number ?? order.virtuemart_order_id ?? ''
    );

    if (!externalOrderId) {
      throw new Error('Joomla plugin: order must have an order_number or virtuemart_order_id');
    }

    const lineItems = normalizeVmLineItems(order);
    const itemsCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    const shippingAddr = resolveShippingAddress(order);

    return {
      externalOrderId,
      platform: 'joomla',
      customerName: buildCustomerName(order),
      customerEmail: resolveCustomerEmail(order),
      customerPhone: resolveCustomerPhone(order),
      shippingAddress: normalizeVmAddress(shippingAddr),
      totalAmount: safeNumber(order.order_total),
      currency: String(order.order_currency_code ?? order.order_currency ?? 'USD').toUpperCase(),
      itemsCount,
      lineItems,
      paymentMethod: resolvePaymentMethod(order),
      ipAddress: safeString(order.ip_address ?? order.customer_ip),
      userAgent: undefined, // VirtueMart does not include user agent in webhook payloads
      platformData: {
        orderStatus: order.order_status,
        orderStatusName: order.order_status_name,
        paymentName: order.payment_name,
        createdOn: order.created_on,
        virtuemartOrderId: order.virtuemart_order_id,
      },
    };
  },
};

registry.register(joomlaPlugin);

export default joomlaPlugin;
