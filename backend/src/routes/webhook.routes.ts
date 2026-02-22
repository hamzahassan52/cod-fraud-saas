import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { registry } from '../plugins/platform-plugin';
import { query, transaction } from '../db/connection';
import { enqueueScoring } from '../services/queue/scoring-queue';
import { normalizePhone } from '../services/phone-normalizer';
import { webhookTotal } from '../services/metrics';
import { config } from '../config';
import { getRedis } from '../services/cache/redis';
import { z } from 'zod';

const platformSchema = z.object({
  platform: z.enum(['shopify', 'woocommerce', 'magento', 'joomla']),
});

export async function webhookRoutes(app: FastifyInstance): Promise<void> {

  // Per-API-key rate limit for webhooks (separate from dashboard rate limit)
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = request.headers['x-api-key'] as string;
    if (!apiKey) return;
    try {
      const redis = await getRedis();
      const minute = Math.floor(Date.now() / 60000);
      const cnt = await redis.incr(`wh_rl_${apiKey}_${minute}`);
      if (cnt === 1) await redis.expire(`wh_rl_${apiKey}_${minute}`, 120);
      if (cnt > config.rateLimit.webhookMax) {
        return reply.code(429).send({
          error: 'Webhook rate limit exceeded',
          retryAfterSeconds: 60,
          limit: config.rateLimit.webhookMax,
        });
      }
    } catch { /* Fail open — Redis down = allow request */ }
  });

  app.post<{ Params: { platform: string } }>(
    '/:platform',
    {},
    async (request: FastifyRequest<{ Params: { platform: string } }>, reply: FastifyReply) => {
      const { platform } = request.params;

      // 1. Validate platform
      const platformParse = platformSchema.safeParse({ platform });
      if (!platformParse.success) {
        return reply.code(400).send({ error: `Unsupported platform: ${platform}` });
      }

      // 2. Get plugin
      const plugin = registry.get(platform);
      if (!plugin) {
        return reply.code(400).send({ error: `No plugin registered for: ${platform}` });
      }

      // 3. Find tenant by API key
      const apiKey = request.headers['x-api-key'] as string;
      if (!apiKey) {
        return reply.code(401).send({ error: 'Missing X-API-Key header' });
      }

      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
      const tenantResult = await query(
        `SELECT ak.tenant_id, t.plan, t.order_limit, t.orders_used,
                t.settings->>'webhookSecrets' as webhook_secrets
         FROM api_keys ak JOIN tenants t ON t.id = ak.tenant_id
         WHERE ak.key_hash = $1 AND ak.is_active = true AND t.is_active = true`,
        [keyHash]
      );

      if (tenantResult.rows.length === 0) {
        return reply.code(401).send({ error: 'Invalid API key' });
      }

      const tenant = tenantResult.rows[0];
      const tenantId = tenant.tenant_id;

      // 4. Check usage limit
      if (tenant.order_limit > 0 && tenant.orders_used >= tenant.order_limit) {
        return reply.code(429).send({
          error: 'Monthly order limit reached',
          limit: tenant.order_limit,
          used: tenant.orders_used,
        });
      }

      // 5. Validate webhook signature
      const rawBody = (request as any).rawBody || JSON.stringify(request.body);

      if (platform === 'shopify') {
        if (!config.shopify.clientSecret) {
          return reply.code(503).send({ error: 'SHOPIFY_CLIENT_SECRET not configured' });
        }
        const valid = plugin.validateWebhook(
          request.headers as Record<string, string>,
          rawBody,
          config.shopify.clientSecret
        );
        if (!valid) return reply.code(401).send({ error: 'Invalid Shopify webhook signature' });
      } else {
        const secret = tenant.webhook_secrets?.[platform] || '';
        if (secret) {
          const valid = plugin.validateWebhook(
            request.headers as Record<string, string>,
            rawBody,
            secret
          );
          if (!valid) return reply.code(401).send({ error: 'Invalid webhook signature' });
        }
      }

      // 6. Normalize order
      let normalizedOrder;
      try {
        normalizedOrder = plugin.normalizeOrder(request.body);
      } catch (err: any) {
        return reply.code(400).send({ error: 'Failed to parse order', details: err.message });
      }

      // 7. Normalize phone
      const phone = normalizePhone(normalizedOrder.customerPhone || '');

      // 8. Insert order (idempotent) and enqueue scoring
      const orderId = await transaction(async (client) => {
        const insertResult = await client.query(
          `INSERT INTO orders (
            tenant_id, external_order_id, platform, platform_data,
            customer_name, customer_email, customer_phone, phone_normalized, phone_carrier,
            shipping_address, shipping_city, shipping_state, shipping_zip, shipping_country,
            payment_method, currency, total_amount, items_count, line_items,
            ip_address, user_agent, status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'pending')
          ON CONFLICT (tenant_id, external_order_id, platform) DO UPDATE SET
            platform_data = EXCLUDED.platform_data,
            updated_at = NOW()
          RETURNING id`,
          [
            tenantId,
            normalizedOrder.externalOrderId,
            platform,
            JSON.stringify(normalizedOrder.platformData),
            normalizedOrder.customerName,
            normalizedOrder.customerEmail,
            normalizedOrder.customerPhone,
            phone.normalized,
            phone.carrier,
            JSON.stringify(normalizedOrder.shippingAddress),
            normalizedOrder.shippingAddress.city,
            normalizedOrder.shippingAddress.state,
            normalizedOrder.shippingAddress.zip,
            normalizedOrder.shippingAddress.country || 'PK',
            normalizedOrder.paymentMethod,
            normalizedOrder.currency,
            normalizedOrder.totalAmount,
            normalizedOrder.itemsCount,
            JSON.stringify(normalizedOrder.lineItems),
            normalizedOrder.ipAddress || request.ip,
            normalizedOrder.userAgent || request.headers['user-agent'],
          ]
        );

        await client.query(
          'UPDATE tenants SET orders_used = orders_used + 1 WHERE id = $1',
          [tenantId]
        );

        return insertResult.rows[0].id;
      });

      // 9. Enqueue for background scoring (deduped)
      await enqueueScoring(orderId, tenantId, tenant.plan);

      // 10. Track metric
      webhookTotal.inc({ platform, status: 'accepted' });

      return reply.code(202).send({
        success: true,
        orderId,
        message: 'Order received and queued for fraud scoring',
        phone: {
          normalized: phone.normalized,
          carrier: phone.carrier,
          valid: phone.isValid,
        },
      });
    }
  );
}
