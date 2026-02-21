import { query } from '../../db/connection';
import { createTrainingEvent, updatePhoneStats } from '../training/training-events';

const AUTO_DELIVERED_DAYS = 7; // After 7 days of dispatch, assume delivered

/**
 * Nightly cron job: auto-mark dispatched orders as delivered.
 *
 * Orders dispatched more than AUTO_DELIVERED_DAYS ago and not yet
 * returned are assumed delivered → create training_event (label = 0).
 *
 * This completes the self-learning loop for good customers.
 */
export async function runAutoDeliveredCron(): Promise<void> {
  console.log('[AutoDelivered] Starting auto-delivered cron...');

  // Find all dispatched orders older than threshold, across all tenants
  const result = await query(
    `SELECT id, tenant_id, phone_normalized
     FROM orders
     WHERE final_status = 'dispatched'
       AND dispatched_at < NOW() - INTERVAL '${AUTO_DELIVERED_DAYS} days'
     LIMIT 500`,
    []
  );

  if (result.rows.length === 0) {
    console.log('[AutoDelivered] No orders to process.');
    return;
  }

  console.log(`[AutoDelivered] Processing ${result.rows.length} orders...`);
  let processed = 0;

  for (const order of result.rows) {
    try {
      // Mark as delivered
      await query(
        `UPDATE orders SET
           final_status = 'delivered',
           delivered_at = NOW(),
           status = 'delivered',
           updated_at = NOW()
         WHERE id = $1 AND tenant_id = $2 AND final_status = 'dispatched'`,
        [order.id, order.tenant_id]
      );

      // Create training event (label = 0 = delivered = good customer)
      await createTrainingEvent(order.id, order.tenant_id, 0, 'auto_cron');

      // Update phone stats
      if (order.phone_normalized) {
        await updatePhoneStats(order.phone_normalized, 0);
      }

      processed++;
    } catch (err: any) {
      console.error(`[AutoDelivered] Failed for order ${order.id}:`, err.message);
    }
  }

  console.log(`[AutoDelivered] Done. Processed ${processed} orders as delivered.`);
}
