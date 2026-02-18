import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRedis } from '../services/cache/redis';
import crypto from 'crypto';

/**
 * Security Middleware Suite
 * - Webhook replay protection
 * - Idempotency key for order creation
 * - Per-tenant rate limiting
 * - Strict tenant isolation enforcement
 */

// ============================================
// Webhook Replay Protection
// ============================================
export async function replayProtection(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const timestamp = request.headers['x-webhook-timestamp'] as string;
  if (timestamp) {
    const webhookTime = parseInt(timestamp, 10) * 1000;
    const now = Date.now();
    const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

    if (Math.abs(now - webhookTime) > MAX_AGE_MS) {
      reply.code(401).send({
        error: 'Webhook timestamp too old or too far in future',
        maxAgeSeconds: MAX_AGE_MS / 1000,
      });
      return;
    }
  }

  // Deduplicate by request signature
  const body = JSON.stringify(request.body);
  const signature = crypto
    .createHash('sha256')
    .update(`${request.method}:${request.url}:${body}`)
    .digest('hex');

  try {
    const redis = await getRedis();
    const key = `replay:${signature}`;
    const exists = await redis.get(key);

    if (exists) {
      reply.code(409).send({
        error: 'Duplicate webhook detected',
        message: 'This webhook has already been processed',
      });
      return;
    }

    // Store for 10 minutes
    await redis.setEx(key, 600, '1');
  } catch {
    // Redis failure shouldn't block webhooks
  }
}

// ============================================
// Idempotency Key
// ============================================
export async function idempotencyCheck(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const idempotencyKey = request.headers['idempotency-key'] as string;
  if (!idempotencyKey) return; // Optional

  try {
    const redis = await getRedis();
    const cacheKey = `idempotency:${(request as any).tenantId}:${idempotencyKey}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      const response = JSON.parse(cached);
      reply.code(response.statusCode || 200).send(response.body);
      return;
    }

    // Store key to mark as processing
    (request as any).__idempotencyKey = cacheKey;
  } catch {
    // Continue without idempotency on Redis failure
  }
}

// After response, cache the result for idempotent requests
export async function idempotencyStore(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (request, reply, payload) => {
    const cacheKey = (request as any).__idempotencyKey;
    if (!cacheKey) return payload;

    try {
      const redis = await getRedis();
      await redis.setEx(
        cacheKey,
        86400, // 24 hours
        JSON.stringify({
          statusCode: reply.statusCode,
          body: typeof payload === 'string' ? JSON.parse(payload) : payload,
        })
      );
    } catch {
      // Best effort
    }

    return payload;
  });
}

// ============================================
// Per-Tenant Rate Limiting
// ============================================
export async function perTenantRateLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const tenantId = (request as any).tenantId;
  if (!tenantId) return;

  try {
    const redis = await getRedis();
    const key = `ratelimit:${tenantId}:${Math.floor(Date.now() / 60000)}`; // per minute
    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 60);
    }

    // Tenant tier limits (per minute)
    const limits: Record<string, number> = {
      free: 30,
      starter: 100,
      growth: 300,
      enterprise: 1000,
    };

    const plan = (request as any).__tenantPlan || 'free';
    const limit = limits[plan] || 30;

    reply.header('x-ratelimit-limit', limit);
    reply.header('x-ratelimit-remaining', Math.max(0, limit - count));

    if (count > limit) {
      reply.code(429).send({
        error: 'Rate limit exceeded',
        limit,
        retryAfterSeconds: 60 - (Math.floor(Date.now() / 1000) % 60),
      });
    }
  } catch {
    // Redis failure = allow request
  }
}

// ============================================
// Tenant Isolation Enforcer
// ============================================
export function enforceTenantIsolation(app: FastifyInstance): void {
  app.addHook('preHandler', async (request, reply) => {
    const tenantId = (request as any).tenantId;
    if (!tenantId) return;

    // Intercept query params to prevent tenant_id injection
    const q = request.query as Record<string, any>;
    if (q.tenant_id && q.tenant_id !== tenantId) {
      reply.code(403).send({
        error: 'Tenant isolation violation',
        message: 'Cannot access resources from another tenant',
      });
    }

    // Intercept body to prevent tenant_id injection
    if (request.body && typeof request.body === 'object') {
      const body = request.body as Record<string, any>;
      if (body.tenant_id && body.tenant_id !== tenantId) {
        reply.code(403).send({
          error: 'Tenant isolation violation',
          message: 'Cannot specify a different tenant_id',
        });
      }
    }
  });
}
