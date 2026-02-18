import { FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/connection';
import crypto from 'crypto';

/**
 * Authentication Middleware
 * Supports two auth methods:
 * 1. JWT Bearer token (for dashboard users)
 * 2. API Key (for webhook/API integrations)
 */

// Extend Fastify request
declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    userId?: string;
    userRole?: string;
    authMethod?: 'jwt' | 'apikey';
  }
}

// JWT Authentication
export async function jwtAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = await request.jwtVerify<{
      userId: string;
      tenantId: string;
      role: string;
    }>();

    request.tenantId = decoded.tenantId;
    request.userId = decoded.userId;
    request.userRole = decoded.role;
    request.authMethod = 'jwt';
  } catch (err) {
    reply.code(401).send({ error: 'Invalid or expired token' });
  }
}

// API Key Authentication
export async function apiKeyAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key'] as string;

  if (!apiKey) {
    reply.code(401).send({ error: 'Missing API key. Provide X-API-Key header.' });
    return;
  }

  // API key format: cfr_<prefix>_<secret>
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  const result = await query(
    `SELECT ak.id, ak.tenant_id, ak.permissions, t.is_active as tenant_active, t.plan, t.order_limit, t.orders_used
     FROM api_keys ak
     JOIN tenants t ON t.id = ak.tenant_id
     WHERE ak.key_hash = $1 AND ak.is_active = true
       AND (ak.expires_at IS NULL OR ak.expires_at > NOW())`,
    [keyHash]
  );

  if (result.rows.length === 0) {
    reply.code(401).send({ error: 'Invalid API key' });
    return;
  }

  const key = result.rows[0];

  if (!key.tenant_active) {
    reply.code(403).send({ error: 'Tenant account is deactivated' });
    return;
  }

  // Update last used
  query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [key.id]).catch(() => {});

  request.tenantId = key.tenant_id;
  request.authMethod = 'apikey';
}

// Combined: try JWT first, then API key
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;
  const apiKey = request.headers['x-api-key'];

  if (authHeader?.startsWith('Bearer ')) {
    return jwtAuth(request, reply);
  }

  if (apiKey) {
    return apiKeyAuth(request, reply);
  }

  reply.code(401).send({ error: 'Authentication required. Provide Bearer token or X-API-Key.' });
}

// Role check middleware factory
export function requireRole(...roles: string[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.authMethod === 'apikey') return; // API keys bypass role checks
    if (!request.userRole || !roles.includes(request.userRole)) {
      reply.code(403).send({ error: 'Insufficient permissions' });
    }
  };
}

// Tenant usage limit check
export async function checkUsageLimit(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!request.tenantId) return;

  const result = await query(
    'SELECT order_limit, orders_used, plan FROM tenants WHERE id = $1',
    [request.tenantId]
  );

  if (result.rows.length === 0) return;

  const { order_limit, orders_used } = result.rows[0];

  if (order_limit > 0 && orders_used >= order_limit) {
    reply.code(429).send({
      error: 'Monthly order limit reached',
      limit: order_limit,
      used: orders_used,
      upgrade: 'Contact support or upgrade your plan',
    });
  }
}
