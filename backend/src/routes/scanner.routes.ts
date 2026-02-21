import { FastifyInstance } from 'fastify';
import { authenticate } from '../middlewares/auth';
import { query } from '../db/connection';
import { createTrainingEvent, updatePhoneStats } from '../services/training/training-events';

export async function scannerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  /**
   * POST /scanner/scan
   * Staff scans barcode on returned parcel → order automatically marked as returned.
   * Body: { tracking_number: string }
   *
   * This is the core of the self-learning loop:
   *   scan → mark returned → create training_event (label=1) → update phone stats
   */
  app.post<{ Body: { tracking_number: string } }>(
    '/scan',
    async (request, reply) => {
      const { tracking_number } = request.body as any;
      const tenantId = request.tenantId!;

      if (!tracking_number?.trim()) {
        return reply.code(400).send({ error: 'tracking_number is required' });
      }

      const tn = tracking_number.trim().toUpperCase();

      // Find order by tracking number
      const orderResult = await query(
        `SELECT id, tenant_id, customer_name, customer_phone, phone_normalized,
                risk_score, risk_level, recommendation, final_status, external_order_id
         FROM orders
         WHERE tracking_number = $1 AND tenant_id = $2`,
        [tn, tenantId]
      );

      if (orderResult.rows.length === 0) {
        return reply.code(404).send({
          success: false,
          result: 'not_found',
          message: `No order found with tracking number ${tn}`,
        });
      }

      const order = orderResult.rows[0];

      // Already processed
      if (order.final_status === 'returned') {
        return reply.send({
          success: true,
          result: 'already_processed',
          message: 'Order already marked as returned',
          order: {
            id: order.id,
            customer_name: order.customer_name,
            risk_score: order.risk_score,
            final_status: order.final_status,
          },
        });
      }

      // Update order to returned
      await query(
        `UPDATE orders SET
           final_status = 'returned',
           returned_at = NOW(),
           status = 'rto',
           rto_at = NOW(),
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2`,
        [order.id, tenantId]
      );

      // Create training event (label = 1 = returned = fraud/RTO)
      await createTrainingEvent(order.id, tenantId, 1, 'scanner');

      // Update phone stats
      if (order.phone_normalized) {
        await updatePhoneStats(order.phone_normalized, 1);
      }

      // Audit log
      await query(
        `INSERT INTO risk_logs (tenant_id, order_id, action, actor_type, actor_id, new_state)
         VALUES ($1, $2, 'return_scanned', 'user', $3, $4)`,
        [
          tenantId,
          order.id,
          request.userId,
          JSON.stringify({ tracking_number: tn, outcome: 'returned' }),
        ]
      );

      return reply.send({
        success: true,
        result: 'marked_returned',
        order: {
          id: order.id,
          external_order_id: order.external_order_id,
          customer_name: order.customer_name,
          risk_score: order.risk_score,
          risk_level: order.risk_level,
          original_recommendation: order.recommendation,
          final_status: 'returned',
        },
        message: 'Order marked as returned. Training data recorded.',
      });
    }
  );

  /**
   * GET /scanner/lookup/:tracking_number
   * Preview: lookup order before scanning (optional — for UI confirmation step)
   */
  app.get<{ Params: { tracking_number: string } }>(
    '/lookup/:tracking_number',
    async (request, reply) => {
      const { tracking_number } = request.params;
      const tenantId = request.tenantId!;

      const result = await query(
        `SELECT id, external_order_id, customer_name, customer_phone,
                risk_score, risk_level, recommendation, final_status,
                total_amount, created_at, dispatched_at
         FROM orders
         WHERE tracking_number = $1 AND tenant_id = $2`,
        [tracking_number.trim().toUpperCase(), tenantId]
      );

      if (result.rows.length === 0) {
        return reply.code(404).send({ found: false });
      }

      return reply.send({ found: true, order: result.rows[0] });
    }
  );
}
