import { FastifyInstance } from 'fastify';
import { jwtAuth } from '../middlewares/auth';
import { query } from '../db/connection';
import { config } from '../config';
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

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function httpsPostJson(url: string, body: string, headers: Record<string, string>): Promise<any> {
  return httpsPost(url, body, { 'Content-Type': 'application/json', ...headers });
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
      const tokenRes = await httpsPostJson(
        `https://${shop}/admin/oauth/access_token`,
        JSON.stringify({ client_id: config.shopify.clientId, client_secret: config.shopify.clientSecret, code }),
        {}
      );

      const accessToken = tokenRes.access_token;
      if (!accessToken) {
        return reply.code(400).send({ error: 'Failed to obtain access token' });
      }

      // Register order/create webhook
      let webhookId: string | null = null;
      try {
        const webhookRes = await httpsPostJson(
          `https://${shop}/admin/api/2024-01/webhooks.json`,
          JSON.stringify({
            webhook: {
              topic: 'orders/create',
              address: `${BACKEND_URL}/api/v1/webhook/shopify`,
              format: 'json',
            },
          }),
          { 'X-Shopify-Access-Token': accessToken }
        );
        webhookId = webhookRes.webhook?.id?.toString() || null;
      } catch {
        // Webhook registration failure is non-fatal
      }

      await query(
        `INSERT INTO shopify_connections (tenant_id, shop, access_token, scopes, webhook_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id) DO UPDATE
           SET shop = EXCLUDED.shop,
               access_token = EXCLUDED.access_token,
               scopes = EXCLUDED.scopes,
               webhook_id = EXCLUDED.webhook_id,
               installed_at = NOW()`,
        [tenantId, shop, accessToken, config.shopify.scopes, webhookId]
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

  // DELETE /shopify/disconnect — remove connection (JWT auth)
  app.delete('/disconnect', { onRequest: [jwtAuth] }, async (request, reply) => {
    const tenantId = request.tenantId!;
    await query('DELETE FROM shopify_connections WHERE tenant_id = $1', [tenantId]);
    return reply.send({ success: true });
  });
}
