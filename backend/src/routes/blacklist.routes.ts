import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middlewares/auth';
import { query } from '../db/connection';
import { normalizePhone } from '../services/phone-normalizer';
import { z } from 'zod';

const addSchema = z.object({
  type: z.enum(['phone', 'email', 'address', 'ip', 'name']),
  value: z.string().min(1).max(500),
  reason: z.string().optional(),
  expiresInDays: z.number().optional(),
});

export async function blacklistRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // POST /blacklist - Add to blacklist
  app.post('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = addSchema.parse(request.body);
    const tenantId = request.tenantId!;

    let normalized = body.value;
    if (body.type === 'phone') {
      const phone = normalizePhone(body.value);
      normalized = phone.normalized;
    } else if (body.type === 'email') {
      normalized = body.value.toLowerCase().trim();
    } else if (body.type === 'ip') {
      normalized = body.value.trim();
    }

    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86400000).toISOString()
      : null;

    await query(
      `INSERT INTO blacklist (tenant_id, type, value, value_normalized, reason, added_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, type, value_normalized) DO UPDATE SET
         reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at`,
      [tenantId, body.type, body.value, normalized, body.reason, request.userId, expiresAt]
    );

    // If phone blacklisted, update phones table
    if (body.type === 'phone') {
      await query(
        `UPDATE phones SET is_blacklisted = true, risk_tier = 'blacklisted' WHERE phone_normalized = $1`,
        [normalized]
      );
    }

    return reply.code(201).send({ success: true, type: body.type, normalized });
  });

  // GET /blacklist - List blacklisted items
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;
    const { type, page = '1', limit = '50' } = request.query as any;

    let whereClause = 'WHERE (tenant_id = $1 OR is_global = true) AND (expires_at IS NULL OR expires_at > NOW())';
    const values: any[] = [tenantId];

    if (type) {
      whereClause += ' AND type = $2';
      values.push(type);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const result = await query(
      `SELECT id, type, value, value_normalized, reason, is_global, expires_at, created_at
       FROM blacklist ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, parseInt(limit), offset]
    );

    return reply.send({ blacklist: result.rows });
  });

  // DELETE /blacklist/:id
  app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const tenantId = request.tenantId!;

    const result = await query(
      'DELETE FROM blacklist WHERE id = $1 AND tenant_id = $2 RETURNING type, value_normalized',
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Blacklist entry not found' });
    }

    // Unblacklist phone if applicable
    if (result.rows[0].type === 'phone') {
      await query(
        `UPDATE phones SET is_blacklisted = false, risk_tier = 'medium' WHERE phone_normalized = $1`,
        [result.rows[0].value_normalized]
      );
    }

    return reply.send({ success: true });
  });
}
