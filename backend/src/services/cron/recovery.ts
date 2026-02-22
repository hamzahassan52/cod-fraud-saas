import { query } from '../../db/connection';
import { enqueueScoring } from '../queue/scoring-queue';

/**
 * Recovery cron: finds orders stuck in 'pending' status (not yet scored)
 * and re-queues them. Runs every 5 minutes.
 *
 * This is the safety net for zero order loss:
 * - Worker crash? Recovery re-queues.
 * - Redis down during enqueue? Recovery re-queues.
 * - Any other failure? Recovery re-queues.
 */
export async function runRecoveryCron(): Promise<void> {
  // Orders pending for more than 5 minutes but less than 24 hours
  const result = await query(
    `SELECT o.id, o.tenant_id, t.plan
     FROM orders o
     JOIN tenants t ON t.id = o.tenant_id
     WHERE o.status = 'pending'
       AND o.created_at < NOW() - INTERVAL '5 minutes'
       AND o.created_at > NOW() - INTERVAL '24 hours'
     LIMIT 100`,
    []
  );

  if (result.rows.length === 0) return;

  console.log(`[Recovery] Found ${result.rows.length} unscored order(s). Re-queuing...`);
  let requeued = 0;

  for (const order of result.rows) {
    try {
      await enqueueScoring(order.id, order.tenant_id, order.plan || 'free');
      requeued++;
    } catch (err: any) {
      console.error(`[Recovery] Failed to re-queue order ${order.id}:`, err.message);
    }
  }

  if (requeued > 0) {
    console.log(`[Recovery] Re-queued ${requeued} order(s).`);
  }
}
