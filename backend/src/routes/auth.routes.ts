import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../db/connection';
import { z } from 'zod';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const registerSchema = z.object({
  name: z.string().min(2).max(255),
  email: z.string().email(),
  password: z.string().min(8).max(100),
  companyName: z.string().min(2).max(255),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /auth/register
  app.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = registerSchema.parse(request.body);

    // Check if email exists
    const existing = await query('SELECT id FROM users WHERE email = $1', [body.email]);
    if (existing.rows.length > 0) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = crypto.createHash('sha256').update(body.password).digest('hex');
    const slug = body.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');

    // Create tenant + user in transaction
    const { transaction } = require('../db/connection');
    const result = await transaction(async (client: any) => {
      // Create tenant
      const tenantResult = await client.query(
        `INSERT INTO tenants (name, slug, plan, order_limit)
         VALUES ($1, $2, 'free', 100) RETURNING id`,
        [body.companyName, `${slug}-${Date.now().toString(36)}`]
      );
      const tenantId = tenantResult.rows[0].id;

      // Create user
      const userResult = await client.query(
        `INSERT INTO users (tenant_id, email, password_hash, name, role)
         VALUES ($1, $2, $3, $4, 'owner') RETURNING id`,
        [tenantId, body.email, passwordHash, body.name]
      );

      // Generate first API key
      const rawKey = `cfr_${uuidv4().replace(/-/g, '')}`;
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const keyPrefix = rawKey.substring(0, 12);

      await client.query(
        `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, permissions)
         VALUES ($1, $2, $3, 'Default Key', '["read","write"]')`,
        [tenantId, keyHash, keyPrefix]
      );

      return {
        tenantId,
        userId: userResult.rows[0].id,
        apiKey: rawKey,
      };
    });

    // Generate JWT
    const token = app.jwt.sign(
      { userId: result.userId, tenantId: result.tenantId, role: 'owner' },
      { expiresIn: '7d' }
    );

    return reply.code(201).send({
      token,
      user: { id: result.userId, email: body.email, name: body.name, role: 'owner' },
      tenant: { id: result.tenantId, name: body.companyName, plan: 'free' },
      apiKey: result.apiKey, // Show only on registration!
    });
  });

  // POST /auth/login
  app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = loginSchema.parse(request.body);
    const passwordHash = crypto.createHash('sha256').update(body.password).digest('hex');

    const result = await query(
      `SELECT u.id, u.tenant_id, u.name, u.role, u.email, t.name as tenant_name, t.plan
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1 AND u.password_hash = $2 AND u.is_active = true AND t.is_active = true`,
      [body.email, passwordHash]
    );

    if (result.rows.length === 0) {
      return reply.code(401).send({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Update last login
    query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => {});

    const token = app.jwt.sign(
      { userId: user.id, tenantId: user.tenant_id, role: user.role },
      { expiresIn: '7d' }
    );

    return reply.send({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      tenant: { id: user.tenant_id, name: user.tenant_name, plan: user.plan },
    });
  });

  // POST /auth/api-keys - Generate new API key
  app.post('/api-keys', {
    onRequest: [async (req, rep) => {
      try { await req.jwtVerify(); } catch { rep.code(401).send({ error: 'Unauthorized' }); }
    }],
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const decoded = request.user as any;
    const { name } = (request.body as any) || { name: 'New Key' };

    const rawKey = `cfr_${uuidv4().replace(/-/g, '')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    await query(
      `INSERT INTO api_keys (tenant_id, key_hash, key_prefix, name, permissions)
       VALUES ($1, $2, $3, $4, '["read","write"]')`,
      [decoded.tenantId, keyHash, keyPrefix, name || 'API Key']
    );

    return reply.code(201).send({
      apiKey: rawKey,
      prefix: keyPrefix,
      message: 'Save this key securely. It cannot be retrieved again.',
    });
  });
}
