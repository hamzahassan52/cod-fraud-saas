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
