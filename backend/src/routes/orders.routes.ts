import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate, checkUsageLimit, apiKeyAuth } from '../middlewares/auth';
import { query } from '../db/connection';
import { z } from 'zod';
import { cacheGetOrSet } from '../services/cache/redis';

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['pending', 'scored', 'approved', 'blocked', 'verified', 'delivered', 'rto']).optional(),
  recommendation: z.enum(['APPROVE', 'VERIFY', 'BLOCK']).optional(),
  platform: z.enum(['shopify', 'woocommerce', 'magento', 'joomla', 'api']).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['created_at', 'risk_score', 'total_amount']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  // External order lookup — API key auth only (for Shopify Extension)
  app.get<{ Params: { platform: string; externalOrderId: string } }>(
    '/external/:platform/:externalOrderId',
    { onRequest: [apiKeyAuth] },
    async (request, reply) => {
      const { platform, externalOrderId } = request.params;
      const tenantId = request.tenantId!;

      const result = await query(
        `SELECT o.id, o.external_order_id, o.platform, o.customer_name,
                o.customer_phone, o.shipping_city, o.total_amount,
                fs.risk_score, fs.risk_level, fs.recommendation
         FROM orders o
         LEFT JOIN fraud_scores fs ON fs.order_id = o.id
         WHERE o.tenant_id = $1 AND o.platform = $2 AND o.external_order_id = $3
         LIMIT 1`,
        [tenantId, platform, externalOrderId]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ found: false });
      }

      const row = result.rows[0];
      return reply.send({
        found: true,
        order_id: row.id,
        external_order_id: row.external_order_id,
        risk_score: row.risk_score,
        risk_level: row.risk_level,
        recommendation: row.recommendation,
        customer_name: row.customer_name,
        dashboard_url: `https://cod-fraud-saas.vercel.app/orders/${row.id}`,
      });
    }
  );

  // All other routes require JWT or API key auth
  app.addHook('onRequest', authenticate);

  // GET /orders - List orders with filtering
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = querySchema.parse(request.query);
    const tenantId = request.tenantId!;
    const offset = (params.page - 1) * params.limit;

    let whereClause = 'WHERE o.tenant_id = $1';
    const values: any[] = [tenantId];
    let paramIdx = 2;

    if (params.status) {
      whereClause += ` AND o.status = $${paramIdx++}`;
      values.push(params.status);
    }
    if (params.recommendation) {
      whereClause += ` AND o.recommendation = $${paramIdx++}`;
      values.push(params.recommendation);
    }
    if (params.platform) {
      whereClause += ` AND o.platform = $${paramIdx++}`;
      values.push(params.platform);
    }
    if (params.search) {
      whereClause += ` AND (o.customer_name ILIKE $${paramIdx} OR o.customer_phone ILIKE $${paramIdx} OR o.customer_email ILIKE $${paramIdx} OR o.external_order_id ILIKE $${paramIdx})`;
      values.push(`%${params.search}%`);
      paramIdx++;
    }
    if (params.dateFrom) {
      whereClause += ` AND o.created_at >= $${paramIdx++}`;
      values.push(params.dateFrom);
    }
    if (params.dateTo) {
      whereClause += ` AND o.created_at <= $${paramIdx++}`;
      values.push(params.dateTo);
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM orders o ${whereClause}`,
      values
    );

    const orderResult = await query(
      `SELECT
        o.id, o.external_order_id, o.platform, o.customer_name, o.customer_email,
        o.customer_phone, o.phone_normalized, o.shipping_city, o.shipping_state,
        o.total_amount, o.currency, o.items_count, o.payment_method,
        o.risk_score, o.risk_level, o.recommendation, o.fraud_signals,
        o.recommendation_reasons, o.risk_summary,
        o.status, o.is_repeat_customer, o.previous_order_count, o.previous_rto_count,
        o.created_at, o.scored_at
      FROM orders o
      ${whereClause}
      ORDER BY o.${params.sortBy} ${params.sortOrder}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...values, params.limit, offset]
    );

    const total = parseInt(countResult.rows[0].count);

    return reply.send({
      orders: orderResult.rows,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    });
  });

  // GET /orders/:id - Get single order with full scoring details
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const tenantId = request.tenantId!;

    const orderResult = await query(
      `SELECT o.*, fs.rule_score, fs.statistical_score, fs.ml_score,
              fs.confidence, fs.signals as score_signals, fs.ml_model_version, fs.scoring_duration_ms
       FROM orders o
       LEFT JOIN fraud_scores fs ON fs.order_id = o.id
       WHERE o.id = $1 AND o.tenant_id = $2`,
      [id, tenantId]
    );

    if (orderResult.rows.length === 0) {
      return reply.code(404).send({ error: 'Order not found' });
    }

    return reply.send({ order: orderResult.rows[0] });
  });

  // GET /risk/:orderId - Get risk details for an order
  app.get<{ Params: { orderId: string } }>('/risk/:orderId', async (request, reply) => {
    const { orderId } = request.params;
    const tenantId = request.tenantId!;

    const result = await query(
      `SELECT fs.*, o.risk_score, o.risk_level, o.recommendation, o.fraud_signals
       FROM fraud_scores fs
       JOIN orders o ON o.id = fs.order_id
       WHERE fs.order_id = $1 AND fs.tenant_id = $2`,
      [orderId, tenantId]
    );

    if (result.rows.length === 0) {
      return reply.code(404).send({ error: 'Risk score not found for this order' });
    }

    return reply.send({ risk: result.rows[0] });
  });

  // POST /orders/:id/override - Manual override recommendation
  app.post<{ Params: { id: string }; Body: { recommendation: string; reason?: string } }>(
    '/:id/override',
    async (request, reply) => {
      const { id } = request.params;
      const { recommendation, reason } = request.body as any;
      const tenantId = request.tenantId!;

      if (!['APPROVE', 'VERIFY', 'BLOCK'].includes(recommendation)) {
        return reply.code(400).send({ error: 'Invalid recommendation' });
      }

      const prev = await query(
        'SELECT recommendation, risk_score FROM orders WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );

      if (prev.rows.length === 0) {
        return reply.code(404).send({ error: 'Order not found' });
      }

      // Update order with override fields
      await query(
        `UPDATE orders SET
          recommendation = $1,
          status = $2,
          override_recommendation = $1,
          override_reason = $3,
          override_by = $4,
          override_at = NOW(),
          updated_at = NOW()
         WHERE id = $5 AND tenant_id = $6`,
        [recommendation, recommendation.toLowerCase(), reason || null, request.userId, id, tenantId]
      );

      // Log override for audit trail
      await query(
        `INSERT INTO risk_logs (tenant_id, order_id, action, actor_type, actor_id, previous_state, new_state, metadata)
         VALUES ($1, $2, 'overridden', 'user', $3, $4, $5, $6)`,
        [
          tenantId,
          id,
          request.userId,
          JSON.stringify({ recommendation: prev.rows[0].recommendation }),
          JSON.stringify({ recommendation }),
          JSON.stringify({ reason }),
        ]
      );

      return reply.send({ success: true, recommendation, previousRecommendation: prev.rows[0].recommendation });
    }
  );
}
