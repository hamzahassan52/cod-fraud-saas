import { query } from '../../db/connection';
import { enqueueScoring } from '../queue/scoring-queue';
import { getRedis } from '../cache/redis';

const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * Recovery cron: finds orders stuck in 'pending' status (not yet scored)
 * and re-queues them. Runs every 5 minutes.
 *
 * Zero order loss safety net:
 * - Worker crashed? Recovery re-queues.
 * - Redis was down during enqueue? Recovery re-queues.
 * - Job failed 3x and moved to DLQ? Recovery re-queues (up to MAX_RECOVERY_ATTEMPTS).
 *
 * Max recovery attempts prevents infinite loops on permanently broken orders.
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
  let skipped = 0;

  let redis: Awaited<ReturnType<typeof getRedis>> | null = null;
  try { redis = await getRedis(); } catch { /* proceed without Redis tracking */ }

  for (const order of result.rows) {
    try {
      // Check recovery attempt count to prevent infinite loops
      if (redis) {
        const countKey = `score_recovery_count_${order.id}`;
        const count = await redis.incr(countKey);
        await redis.expire(countKey, 86400); // 24h TTL
        if (count > MAX_RECOVERY_ATTEMPTS) {
          console.warn(`[Recovery] Order ${order.id} exceeded max recovery attempts (${count}). Skipping — manual investigation required.`);
          skipped++;
          continue;
        }
      }

      await enqueueScoring(order.id, order.tenant_id, order.plan || 'free');
      requeued++;
    } catch (err: any) {
      console.error(`[Recovery] Failed to re-queue order ${order.id}:`, err.message);
    }
  }

  if (requeued > 0 || skipped > 0) {
    console.log(`[Recovery] Re-queued: ${requeued}, Skipped (max attempts): ${skipped}`);
  }
}
