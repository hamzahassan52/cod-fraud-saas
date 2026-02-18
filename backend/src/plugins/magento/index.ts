import crypto from 'crypto';
import { NormalizedWebhookOrder, Platform, Address, LineItem } from '../../types';
import { PlatformPlugin, registry } from '../platform-plugin';

interface MagentoAddress {
  firstname?: string;
  lastname?: string;
  company?: string;
  street?: string[] | string;
  city?: string;
  region?: string;
  region_code?: string;
  postcode?: string;
  country_id?: string;
  telephone?: string;
}

interface MagentoItem {
  name?: string;
  sku?: string;
  qty_ordered?: number;
  price?: number | string;
  row_total?: number | string;
  product_type?: string;
}

interface MagentoPayment {
  method?: string;
  additional_information?: string[];
}

interface MagentoExtensionAttributes {
  shipping_assignments?: Array<{
    shipping?: {
      address?: MagentoAddress;
    };
  }>;
}

interface MagentoOrder {
  entity_id?: number | string;
  increment_id?: string;
  customer_firstname?: string;
  customer_lastname?: string;
  customer_email?: string;
  billing_address?: MagentoAddress;
  extension_attributes?: MagentoExtensionAttributes;
  items?: MagentoItem[];
  grand_total?: number | string;
  base_grand_total?: number | string;
  order_currency_code?: string;
  base_currency_code?: string;
  payment?: MagentoPayment;
  remote_ip?: string;
  status?: string;
  state?: string;
  store_name?: string;
  customer_is_guest?: boolean | number;
  total_item_count?: number;
  created_at?: string;
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

function normalizeMagentoAddress(addr?: MagentoAddress): Address {
  if (!addr) return {};

  let address1: string | undefined;
  let address2: string | undefined;

  if (Array.isArray(addr.street)) {
    address1 = addr.street[0] ?? undefined;
    address2 = addr.street.slice(1).join(', ') || undefined;
  } else if (typeof addr.street === 'string') {
    address1 = addr.street;
  }

  return {
    address1,
    address2,
    city: safeString(addr.city),
    state: safeString(addr.region_code ?? addr.region),
    zip: safeString(addr.postcode),
    country: safeString(addr.country_id),
  };
}

function normalizeMagentoLineItems(items?: MagentoItem[]): LineItem[] {
  if (!Array.isArray(items)) return [];
  // Magento includes configurable parent items and simple children;
  // filter out configurable parents to avoid double-counting when children exist
  const hasChildren = items.some((i) => i.product_type === 'simple');
  const filtered = hasChildren
    ? items.filter((i) => i.product_type !== 'configurable')
    : items;

  return filtered.map((item) => ({
    name: String(item.name ?? 'Unknown Item'),
    sku: safeString(item.sku),
    quantity: Math.max(0, Math.round(safeNumber(item.qty_ordered))),
    price: safeNumber(item.price ?? item.row_total),
  }));
}

function resolveShippingAddress(order: MagentoOrder): MagentoAddress | undefined {
  // Shipping address can live in extension_attributes.shipping_assignments
  const assignments = order.extension_attributes?.shipping_assignments;
  if (Array.isArray(assignments) && assignments.length > 0) {
    const addr = assignments[0]?.shipping?.address;
    if (addr) return addr;
  }
  // Fall back to billing_address
  return order.billing_address;
}

function buildCustomerName(order: MagentoOrder): string | undefined {
  if (order.customer_firstname || order.customer_lastname) {
    return [order.customer_firstname, order.customer_lastname]
      .filter(Boolean)
      .join(' ')
      .trim() || undefined;
  }
  const addr = order.billing_address;
  if (addr?.firstname || addr?.lastname) {
    return [addr.firstname, addr.lastname].filter(Boolean).join(' ').trim() || undefined;
  }
  return undefined;
}

function resolveCustomerPhone(order: MagentoOrder): string | undefined {
  const shippingAddr = resolveShippingAddress(order);
  return safeString(shippingAddr?.telephone ?? order.billing_address?.telephone);
}

const magentoPlugin: PlatformPlugin = {
  name: 'magento' as Platform,

  validateWebhook(headers: Record<string, string>, body: string, secret: string): boolean {
    const headerKey = 'x-magento-signature';
    const signatureHeader = headers[headerKey]
      ?? headers['X-Magento-Signature']
      ?? headers['X-MAGENTO-SIGNATURE'];

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
      throw new Error('Magento plugin: rawPayload must be a non-null object');
    }

    const order = rawPayload as MagentoOrder;
    const externalOrderId = String(order.increment_id ?? order.entity_id ?? '');

    if (!externalOrderId) {
      throw new Error('Magento plugin: order must have an increment_id or entity_id');
    }

    const lineItems = normalizeMagentoLineItems(order.items);
    const itemsCount = lineItems.reduce((sum, item) => sum + item.quantity, 0);
    const shippingAddr = resolveShippingAddress(order);

    return {
      externalOrderId,
      platform: 'magento',
      customerName: buildCustomerName(order),
      customerEmail: safeString(order.customer_email),
      customerPhone: resolveCustomerPhone(order),
      shippingAddress: normalizeMagentoAddress(shippingAddr),
      totalAmount: safeNumber(order.grand_total ?? order.base_grand_total),
      currency: String(order.order_currency_code ?? order.base_currency_code ?? 'USD').toUpperCase(),
      itemsCount,
      lineItems,
      paymentMethod: String(order.payment?.method ?? 'unknown'),
      ipAddress: safeString(order.remote_ip),
      userAgent: undefined, // Magento does not include user agent in order webhooks
      platformData: {
        status: order.status,
        state: order.state,
        storeName: order.store_name,
        customerIsGuest: order.customer_is_guest,
        createdAt: order.created_at,
        entityId: order.entity_id,
      },
    };
  },
};

registry.register(magentoPlugin);

export default magentoPlugin;
