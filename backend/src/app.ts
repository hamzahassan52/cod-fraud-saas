import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import jwt from '@fastify/jwt';
import { config } from './config';

// Routes
import { webhookRoutes } from './routes/webhook.routes';
import { authRoutes } from './routes/auth.routes';
import { orderRoutes } from './routes/orders.routes';
import { blacklistRoutes } from './routes/blacklist.routes';
import { analyticsRoutes } from './routes/analytics.routes';
import { healthRoutes } from './routes/health.routes';
import { mlRoutes } from './routes/ml.routes';
import { shopifyRoutes } from './routes/shopify.routes';
import { scannerRoutes } from './routes/scanner.routes';

// Middleware
import { requestIdPlugin } from './middlewares/request-id';
import { metricsPlugin } from './middlewares/metrics';
import { idempotencyStore, enforceTenantIsolation } from './middlewares/security';
import { errorTotal } from './services/metrics';

// Plugins - register all platform plugins
import './plugins/shopify';
import './plugins/woocommerce';
import './plugins/magento';
import './plugins/joomla';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.server.env === 'production' ? 'info' : 'debug',
      transport: config.server.env !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
      // Structured JSON logs in production (pino default)
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
            remoteAddress: request.ip,
            requestId: (request as any).requestId,
          };
        },
      },
    },
    trustProxy: true,
    bodyLimit: 1048576, // 1MB
    genReqId: () => require('uuid').v4(), // Auto request ID
  });

  // ---- Core Plugins ----
  await app.register(cors, {
    origin: config.server.env === 'production'
      ? (process.env.CORS_ORIGINS || 'https://*.codfraud.com').split(',').map(s => s.trim())
      : true,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.window,
    keyGenerator: (request) => {
      return (request.headers['x-api-key'] as string) || request.ip;
    },
  });

  await app.register(jwt, {
    secret: config.jwt.secret,
  });

  // ---- Observability Middleware ----
  await app.register(requestIdPlugin);
  await app.register(metricsPlugin);

  // ---- Security Middleware ----
  await app.register(idempotencyStore);
  enforceTenantIsolation(app);

  // ---- Health / Metrics / Probes (no auth required) ----
  await app.register(healthRoutes);

  // ---- API Routes ----
  await app.register(webhookRoutes, { prefix: '/api/v1/webhook' });
  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(orderRoutes, { prefix: '/api/v1/orders' });
  await app.register(blacklistRoutes, { prefix: '/api/v1/blacklist' });
  await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
  await app.register(mlRoutes, { prefix: '/api/v1/ml' });
  await app.register(shopifyRoutes, { prefix: '/api/v1/shopify' });
  await app.register(scannerRoutes, { prefix: '/api/v1/scanner' });

  // GET /api/v1/settings/thresholds
  app.get('/api/v1/settings/thresholds', async (request, reply) => {
    try { await (request as any).jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const tenantId = (request as any).user?.tenantId;
    const { query: dbQuery } = await import('./db/connection');
    const result = await dbQuery(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    const settings = result.rows[0]?.settings || {};
    return reply.send({
      block_threshold: settings.blockThreshold ?? 70,
      verify_threshold: settings.verifyThreshold ?? 40,
    });
  });

  // GET /api/v1/settings/webhook-secrets — returns masked secrets (first 4 chars only)
  app.get('/api/v1/settings/webhook-secrets', async (request, reply) => {
    try { await (request as any).jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const tenantId = (request as any).user?.tenantId;
    const { query: dbQuery } = await import('./db/connection');
    const result = await dbQuery(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    const settings = result.rows[0]?.settings || {};
    const secrets: Record<string, string> = settings.webhookSecrets || {};
    const masked: Record<string, boolean> = {};
    for (const [platform, secret] of Object.entries(secrets)) {
      masked[platform] = typeof secret === 'string' && secret.length > 0;
    }
    return reply.send({ configured: masked });
  });

  // PUT /api/v1/settings/webhook-secrets — save webhook HMAC secret for a platform
  app.put('/api/v1/settings/webhook-secrets', async (request, reply) => {
    try { await (request as any).jwtVerify(); } catch { return reply.code(401).send({ error: 'Unauthorized' }); }
    const tenantId = (request as any).user?.tenantId;
    const { platform, secret } = request.body as any;
    const allowed = ['woocommerce', 'magento', 'joomla'];
    if (!allowed.includes(platform)) {
      return reply.code(400).send({ error: 'Invalid platform. Must be one of: ' + allowed.join(', ') });
    }
    if (typeof secret !== 'string' || secret.length < 8) {
      return reply.code(400).send({ error: 'Secret must be at least 8 characters' });
    }
    const { query: dbQuery } = await import('./db/connection');
    const result = await dbQuery(`SELECT settings FROM tenants WHERE id = $1`, [tenantId]);
    const settings = result.rows[0]?.settings || {};
    settings.webhookSecrets = settings.webhookSecrets || {};
    settings.webhookSecrets[platform] = secret;
    await dbQuery(`UPDATE tenants SET settings = $1 WHERE id = $2`, [JSON.stringify(settings), tenantId]);
    return reply.send({ success: true, platform });
  });

  // ---- Global Error Handler ----
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      app.log.error(error);
      errorTotal.inc({ type: 'internal' });
    } else if (statusCode === 401 || statusCode === 403) {
      errorTotal.inc({ type: 'auth' });
    } else if (statusCode === 400) {
      errorTotal.inc({ type: 'validation' });
    }

    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      statusCode,
      requestId: request.id,
      ...(config.server.env !== 'production' && { stack: error.stack }),
    });
  });

  // ---- 404 Handler ----
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'Route not found',
      method: request.method,
      url: request.url,
      requestId: request.id,
    });
  });

  return app;
}
