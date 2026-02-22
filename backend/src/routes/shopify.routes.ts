import { FastifyInstance } from 'fastify';
import { jwtAuth } from '../middlewares/auth';
import { query } from '../db/connection';
import { config } from '../config';
import { encryptToken, decryptToken } from '../services/crypto/token-encryption';
import crypto from 'crypto';
import https from 'https';

const FRONTEND_URL = process.env.CORS_ORIGINS?.split(',')[0]?.trim() || 'https://cod-fraud-saas.vercel.app';
const BACKEND_URL = process.env.BACKEND_URL || 'https://cod-fraud-saas-production.up.railway.app';

function verifyHmac(query: Record<string, string>, secret: string): boolean {
  const { hmac, ...rest } = query;
  if (!hmac) return false;
  const message = Object.keys(rest).sort().map(k => `${k}=${rest[k]}`).join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqHeaders: Record<string, string | number> = { ...headers };
    if (body) reqHeaders['Content-Length'] = Buffer.byteLength(body);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: reqHeaders,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function backfillShopifyOrders(
  shop: string,
  accessToken: string,
  tenantId: string,
  plan: string
): Promise<void> {
  try {
    const data = await httpsRequest(
      'GET',
      `https://${shop}/admin/api/2024-01/orders.json?limit=50&status=any`,
      { 'X-Shopify-Access-Token': accessToken }
    );
    const orders: any[] = data?.orders || [];
    const { registry } = await import('../plugins/platform-plugin');
    const { enqueueScoring } = await import('../services/queue/scoring-queue');
    const { normalizePhone } = await import('../services/phone-normalizer');
    const { query: dbQuery } = await import('../db/connection');
    const plugin = registry.get('shopify');
    if (!plugin) return;

    for (const rawOrder of orders) {
      try {
        const norm = plugin.normalizeOrder(rawOrder);
        const phone = normalizePhone(norm.customerPhone || '');
        const r = await dbQuery(
          `INSERT INTO orders (
             tenant_id, external_order_id, platform, platform_data,
             customer_name, customer_email, customer_phone, phone_normalized,
             shipping_address, shipping_city, total_amount, items_count, line_items,
             payment_method, currency, status
           ) VALUES ($1,$2,'shopify',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')
           ON CONFLICT (tenant_id, external_order_id, platform) DO NOTHING RETURNING id`,
          [
            tenantId, norm.externalOrderId, JSON.stringify(norm.platformData),
            norm.customerName, norm.customerEmail, norm.customerPhone,
            phone.normalized, JSON.stringify(norm.shippingAddress),
            norm.shippingAddress?.city, norm.totalAmount, norm.itemsCount,
            JSON.stringify(norm.lineItems), norm.paymentMethod, norm.currency,
          ]
        );
        if (r.rows[0]?.id) await enqueueScoring(r.rows[0].id, tenantId, plan);
      } catch { /* Skip malformed orders */ }
    }
  } catch (err: any) {
    console.warn('[Shopify] Backfill failed:', err.message);
  }
}

export async function shopifyRoutes(app: FastifyInstance): Promise<void> {
  // GET /shopify/install — start OAuth flow
  app.get<{ Querystring: { shop: string; tenant_id: string } }>('/install', async (request, reply) => {
    const { shop, tenant_id } = request.query as any;

    if (!shop || !tenant_id) {
      return reply.code(400).send({ error: 'shop and tenant_id are required' });
    }

    if (!/^[a-zA-Z0-9-]+\.myshopify\.com$/.test(shop)) {
      return reply.code(400).send({ error: 'Invalid shop URL format' });
    }

    const redirectUri = `${BACKEND_URL}/api/v1/shopify/callback`;
    const installUrl =
      `https://${shop}/admin/oauth/authorize` +
      `?client_id=${config.shopify.clientId}` +
      `&scope=${config.shopify.scopes}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${tenant_id}`;

    return reply.redirect(installUrl);
  });

  // GET /shopify/callback — OAuth callback
  app.get('/callback', async (request, reply) => {
    const qs = request.query as Record<string, string>;
    const { code, shop, state: tenantId } = qs;

    if (!code || !shop || !tenantId) {
      return reply.code(400).send({ error: 'Missing required OAuth params' });
    }

    if (!verifyHmac(qs, config.shopify.clientSecret)) {
      return reply.code(401).send({ error: 'HMAC verification failed' });
    }

    try {
      const tokenRes = await httpsRequest(
        'POST',
        `https://${shop}/admin/oauth/access_token`,
        { 'Content-Type': 'application/json' },
        JSON.stringify({ client_id: config.shopify.clientId, client_secret: config.shopify.clientSecret, code })
      );

      const accessToken = tokenRes.access_token;
      if (!accessToken) {
        return reply.code(400).send({ error: 'Failed to obtain access token' });
      }

      // Register order/create webhook
      let webhookId: string | null = null;
      try {
        const webhookRes = await httpsRequest(
          'POST',
          `https://${shop}/admin/api/2024-01/webhooks.json`,
          { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken },
          JSON.stringify({
            webhook: {
              topic: 'orders/create',
              address: `${BACKEND_URL}/api/v1/webhook/shopify`,
              format: 'json',
            },
          })
        );
        webhookId = webhookRes.webhook?.id?.toString() || null;
      } catch {
        // Non-fatal
      }

      const encryptedToken = encryptToken(accessToken);

      await query(
        `INSERT INTO shopify_connections (tenant_id, shop, access_token, token_encrypted, scopes, webhook_id)
         VALUES ($1, $2, '[encrypted]', $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE SET
           shop = EXCLUDED.shop,
           access_token = '[encrypted]',
           token_encrypted = EXCLUDED.token_encrypted,
           scopes = EXCLUDED.scopes,
           webhook_id = EXCLUDED.webhook_id,
           installed_at = NOW()`,
        [tenantId, shop, encryptedToken, config.shopify.scopes, webhookId]
      );

      // Fire-and-forget: backfill last 50 orders
      const tenantRow = await query('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
      const tenantPlan = tenantRow.rows[0]?.plan || 'free';
      backfillShopifyOrders(shop, accessToken, tenantId, tenantPlan).catch(err =>
        app.log.warn(err, 'Shopify backfill failed')
      );

      return reply.redirect(`${FRONTEND_URL}/settings?connected=shopify`);
    } catch (err: any) {
      app.log.error(err, 'Shopify OAuth callback error');
      return reply.code(500).send({ error: 'OAuth flow failed' });
    }
  });

  // GET /shopify/status — check connection (JWT auth)
  app.get('/status', { onRequest: [jwtAuth] }, async (request, reply) => {
    const tenantId = request.tenantId!;
    const result = await query(
      'SELECT shop, installed_at FROM shopify_connections WHERE tenant_id = $1',
      [tenantId]
    );
    if (result.rows.length === 0) {
      return reply.send({ connected: false });
    }
    return reply.send({ connected: true, shop: result.rows[0].shop, installed_at: result.rows[0].installed_at });
  });

  // DELETE /shopify/disconnect — remove connection + delete webhook from Shopify
  app.delete('/disconnect', { onRequest: [jwtAuth] }, async (request, reply) => {
    const tenantId = request.tenantId!;
    const result = await query(
      'SELECT shop, webhook_id, token_encrypted FROM shopify_connections WHERE tenant_id = $1',
      [tenantId]
    );
    if (result.rows.length > 0) {
      const { shop, webhook_id, token_encrypted } = result.rows[0];
      if (shop && webhook_id && token_encrypted) {
        try {
          const token = decryptToken(token_encrypted);
          await httpsRequest(
            'DELETE',
            `https://${shop}/admin/api/2024-01/webhooks/${webhook_id}.json`,
            { 'X-Shopify-Access-Token': token }
          );
        } catch { /* Non-fatal — still delete from DB */ }
      }
    }
    await query('DELETE FROM shopify_connections WHERE tenant_id = $1', [tenantId]);
    return reply.send({ success: true });
  });

  // POST /shopify/test-webhook — verify webhook is active on Shopify
  app.post('/test-webhook', { onRequest: [jwtAuth] }, async (request, reply) => {
    const tenantId = request.tenantId!;
    const result = await query(
      'SELECT shop, webhook_id, token_encrypted FROM shopify_connections WHERE tenant_id = $1',
      [tenantId]
    );
    if (!result.rows.length) return reply.code(404).send({ error: 'No Shopify store connected' });

    const { shop, webhook_id, token_encrypted } = result.rows[0];
    if (!token_encrypted) return reply.code(400).send({ error: 'Token unavailable' });

    try {
      const token = decryptToken(token_encrypted);
      const data = await httpsRequest(
        'GET',
        `https://${shop}/admin/api/2024-01/webhooks.json`,
        { 'X-Shopify-Access-Token': token }
      );
      const webhooks: any[] = data?.webhooks || [];
      const ours = webhooks.find(w => String(w.id) === String(webhook_id));
      return reply.send({
        success: true,
        shop,
        webhook_registered: !!ours,
        webhook_id,
        webhook_address: ours?.address || null,
        webhook_topic: ours?.topic || null,
      });
    } catch (err: any) {
      return reply.code(500).send({ error: 'Shopify API unreachable', details: err.message });
    }
  });
}
