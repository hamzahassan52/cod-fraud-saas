import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middlewares/auth';
import { query } from '../db/connection';
import { cacheGetOrSet } from '../services/cache/redis';

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // GET /analytics - Dashboard overview
  app.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;
    const { days = '30' } = request.query as any;
    const daysNum = parseInt(days);

    const analytics = await cacheGetOrSet(`analytics:${tenantId}:${daysNum}`, async () => {
      // Summary stats
      const summaryResult = await query(
        `SELECT
          COUNT(*) as total_orders,
          COUNT(*) FILTER (WHERE recommendation = 'APPROVE') as approved,
          COUNT(*) FILTER (WHERE recommendation = 'BLOCK') as blocked,
          COUNT(*) FILTER (WHERE recommendation = 'VERIFY') as verify,
          COUNT(*) FILTER (WHERE status = 'rto') as total_rto,
          COUNT(*) FILTER (WHERE status = 'delivered') as total_delivered,
          ROUND(AVG(risk_score)::numeric, 2) as avg_risk_score,
          ROUND(SUM(total_amount)::numeric, 2) as total_revenue
        FROM orders
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
        [tenantId, daysNum]
      );

      // Daily breakdown
      const dailyResult = await query(
        `SELECT
          DATE(created_at) as date,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'rto') as rto,
          COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
          COUNT(*) FILTER (WHERE recommendation = 'BLOCK') as blocked,
          ROUND(AVG(risk_score)::numeric, 2) as avg_score
        FROM orders
        WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
        GROUP BY DATE(created_at)
        ORDER BY date DESC`,
        [tenantId, daysNum]
      );

      // Top fraud signals
      const signalsResult = await query(
        `SELECT signal->>'signal' as signal_name, COUNT(*) as count
         FROM orders, jsonb_array_elements(fraud_signals) as signal
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
           AND (signal->>'score')::int > 0
         GROUP BY signal->>'signal'
         ORDER BY count DESC
         LIMIT 10`,
        [tenantId, daysNum]
      );

      // Risk distribution
      const riskDist = await query(
        `SELECT risk_level, COUNT(*) as count
         FROM orders
         WHERE tenant_id = $1 AND risk_level IS NOT NULL
           AND created_at >= NOW() - INTERVAL '1 day' * $2
         GROUP BY risk_level`,
        [tenantId, daysNum]
      );

      // Platform breakdown
      const platformResult = await query(
        `SELECT platform, COUNT(*) as count,
                COUNT(*) FILTER (WHERE status = 'rto') as rto_count
         FROM orders
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
         GROUP BY platform`,
        [tenantId, daysNum]
      );

      // Top RTO cities
      const cityResult = await query(
        `SELECT shipping_city as city,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'rto') as rto,
                ROUND(COUNT(*) FILTER (WHERE status = 'rto')::numeric / NULLIF(COUNT(*), 0) * 100, 1) as rto_rate
         FROM orders
         WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
           AND shipping_city IS NOT NULL
         GROUP BY shipping_city
         HAVING COUNT(*) >= 5
         ORDER BY rto_rate DESC
         LIMIT 10`,
        [tenantId, daysNum]
      );

      const summary = summaryResult.rows[0];
      const totalCompleted = parseInt(summary.total_rto) + parseInt(summary.total_delivered);

      return {
        summary: {
          totalOrders: parseInt(summary.total_orders),
          approved: parseInt(summary.approved),
          blocked: parseInt(summary.blocked),
          verify: parseInt(summary.verify),
          totalRto: parseInt(summary.total_rto),
          totalDelivered: parseInt(summary.total_delivered),
          rtoRate: totalCompleted > 0
            ? Math.round((parseInt(summary.total_rto) / totalCompleted) * 10000) / 100
            : 0,
          avgRiskScore: parseFloat(summary.avg_risk_score) || 0,
          totalRevenue: parseFloat(summary.total_revenue) || 0,
        },
        dailyOrders: dailyResult.rows,
        topFraudSignals: signalsResult.rows,
        riskDistribution: riskDist.rows,
        platformBreakdown: platformResult.rows,
        topRtoCities: cityResult.rows,
      };
    }, 60); // Cache 60 seconds

    return reply.send(analytics);
  });

  // GET /analytics/rto-report - Detailed RTO analysis
  app.get('/rto-report', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;

    const result = await query(
      `SELECT
        r.outcome, r.rto_reason, COUNT(*) as count,
        ROUND(AVG(o.risk_score)::numeric, 2) as avg_risk_score,
        ROUND(AVG(o.total_amount)::numeric, 2) as avg_order_amount
       FROM rto_reports r
       JOIN orders o ON o.id = r.order_id
       WHERE r.tenant_id = $1
       GROUP BY r.outcome, r.rto_reason
       ORDER BY count DESC`,
      [tenantId]
    );

    return reply.send({ rtoReport: result.rows });
  });

  // POST /analytics/rto-feedback - Report delivery outcome (feedback loop)
  app.post('/rto-feedback', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;
    const { orderId, outcome, reason, notes } = request.body as any;

    if (!orderId || !['delivered', 'rto', 'partial_rto'].includes(outcome)) {
      return reply.code(400).send({ error: 'orderId and valid outcome required' });
    }

    // Update order status
    const statusUpdate = outcome === 'delivered'
      ? { status: 'delivered', delivered_at: 'NOW()' }
      : { status: 'rto', rto_at: 'NOW()' };

    await query(
      `UPDATE orders SET status = $1, ${outcome === 'delivered' ? 'delivered_at' : 'rto_at'} = NOW()
       WHERE id = $2 AND tenant_id = $3`,
      [outcome === 'delivered' ? 'delivered' : 'rto', orderId, tenantId]
    );

    // Insert RTO report
    await query(
      `INSERT INTO rto_reports (tenant_id, order_id, outcome, rto_reason, reported_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, orderId, outcome, reason, request.userId, notes]
    );

    // Update phone stats
    if (outcome === 'rto') {
      await query(
        `UPDATE phones SET
          total_rto = total_rto + 1,
          rto_rate = (total_rto + 1)::numeric / NULLIF(total_orders, 0)
         FROM orders o
         WHERE phones.phone_normalized = o.phone_normalized AND o.id = $1`,
        [orderId]
      );
    }

    return reply.send({ success: true, message: `Order marked as ${outcome}` });
  });

  // GET /analytics/override-stats - Override statistics
  app.get('/override-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;
    const { days = '30' } = request.query as any;
    const daysNum = parseInt(days);

    // Total overrides by type
    const byTypeResult = await query(
      `SELECT
        rl.previous_state->>'recommendation' as original,
        rl.new_state->>'recommendation' as overridden_to,
        COUNT(*) as count
       FROM risk_logs rl
       WHERE rl.tenant_id = $1
         AND rl.action = 'overridden'
         AND rl.created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY rl.previous_state->>'recommendation', rl.new_state->>'recommendation'
       ORDER BY count DESC`,
      [tenantId, daysNum]
    );

    // Override accuracy: did the merchant's override match the actual outcome?
    const accuracyResult = await query(
      `SELECT
        COUNT(*) as total_overrides_with_outcome,
        COUNT(*) FILTER (
          WHERE (o.override_recommendation = 'BLOCK' AND o.status = 'rto')
             OR (o.override_recommendation = 'APPROVE' AND o.status = 'delivered')
        ) as correct_overrides,
        COUNT(*) FILTER (
          WHERE (o.override_recommendation = 'BLOCK' AND o.status = 'delivered')
             OR (o.override_recommendation = 'APPROVE' AND o.status = 'rto')
        ) as incorrect_overrides
       FROM orders o
       WHERE o.tenant_id = $1
         AND o.override_at IS NOT NULL
         AND o.status IN ('delivered', 'rto')
         AND o.override_at >= NOW() - INTERVAL '1 day' * $2`,
      [tenantId, daysNum]
    );

    // Most common override reasons
    const reasonsResult = await query(
      `SELECT
        o.override_reason as reason,
        COUNT(*) as count
       FROM orders o
       WHERE o.tenant_id = $1
         AND o.override_at IS NOT NULL
         AND o.override_reason IS NOT NULL
         AND o.override_reason != ''
         AND o.override_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY o.override_reason
       ORDER BY count DESC
       LIMIT 10`,
      [tenantId, daysNum]
    );

    const accuracy = accuracyResult.rows[0];
    const totalWithOutcome = parseInt(accuracy.total_overrides_with_outcome) || 0;
    const correct = parseInt(accuracy.correct_overrides) || 0;

    return reply.send({
      overridesByType: byTypeResult.rows,
      accuracy: {
        totalWithOutcome,
        correct,
        incorrect: parseInt(accuracy.incorrect_overrides) || 0,
        accuracyRate: totalWithOutcome > 0
          ? Math.round((correct / totalWithOutcome) * 10000) / 100
          : null,
      },
      topReasons: reasonsResult.rows,
      period: `${daysNum} days`,
    });
  });
}
