import { query } from '../../db/connection';

const RETRAIN_THRESHOLD = 500;

/**
 * Creates a training event when a final delivery outcome is known.
 * Immutable — written once per order, never updated.
 *
 * @param orderId - The order that has a known outcome
 * @param tenantId - Tenant context
 * @param finalLabel - 0 = delivered (good), 1 = returned (RTO/fraud)
 * @param outcomeSource - How was outcome recorded: 'scanner' | 'auto_cron' | 'manual'
 */
export async function createTrainingEvent(
  orderId: string,
  tenantId: string,
  finalLabel: 0 | 1,
  outcomeSource: 'scanner' | 'auto_cron' | 'manual'
): Promise<void> {
  // Fetch feature snapshot from fraud_scores (saved at prediction time)
  const fsResult = await query(
    `SELECT fs.ml_features, fs.ml_model_version, fs.final_score,
            o.call_confirmed, o.risk_score
     FROM fraud_scores fs
     JOIN orders o ON o.id = fs.order_id
     WHERE fs.order_id = $1 AND fs.tenant_id = $2
     LIMIT 1`,
    [orderId, tenantId]
  );

  if (fsResult.rows.length === 0) return; // No features to save — skip

  const fs = fsResult.rows[0];
  const predictionScore = fs.final_score ? parseFloat(fs.final_score) / 100 : null;
  const predictionLabel = predictionScore !== null ? (predictionScore >= 0.5 ? 1 : 0) : null;
  const predictionCorrect = predictionLabel !== null ? predictionLabel === finalLabel : null;

  // Insert training event — ON CONFLICT DO NOTHING ensures exactly-once per order
  await query(
    `INSERT INTO training_events
       (tenant_id, order_id, feature_snapshot, final_label, call_confirmed,
        model_version, prediction_score, prediction_correct, outcome_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (order_id) DO NOTHING`,
    [
      tenantId,
      orderId,
      JSON.stringify(fs.ml_features || {}),
      finalLabel,
      fs.call_confirmed || null,
      fs.ml_model_version || null,
      predictionScore,
      predictionCorrect,
      outcomeSource,
    ]
  );
}

/**
 * Updates phones table aggregate stats after a delivery outcome.
 */
export async function updatePhoneStats(
  phone: string,
  finalLabel: 0 | 1
): Promise<void> {
  if (!phone) return;

  if (finalLabel === 1) {
    // Returned — increment RTO counter
    await query(
      `UPDATE phones SET
         total_rto = total_rto + 1,
         rto_rate = (total_rto + 1)::decimal / GREATEST(total_orders, 1),
         updated_at = NOW()
       WHERE phone_normalized = $1`,
      [phone]
    );
  } else {
    // Delivered — just update the rate (total_orders already incremented at scoring time)
    await query(
      `UPDATE phones SET
         rto_rate = total_rto::decimal / GREATEST(total_orders, 1),
         updated_at = NOW()
       WHERE phone_normalized = $1`,
      [phone]
    );
  }
}

/**
 * Check if we have enough new training events to trigger retraining.
 * Returns true if >= RETRAIN_THRESHOLD unused events exist for this tenant.
 */
export async function shouldTriggerRetrain(tenantId: string): Promise<boolean> {
  const result = await query(
    `SELECT COUNT(*) as count FROM training_events
     WHERE tenant_id = $1 AND used_in_training = FALSE`,
    [tenantId]
  );
  return parseInt(result.rows[0].count) >= RETRAIN_THRESHOLD;
}

/**
 * Get training data stats for a tenant (shown on ML page).
 */
export async function getTrainingStats(tenantId: string): Promise<{
  total: number;
  unused: number;
  label0: number;
  label1: number;
  threshold: number;
  readyToRetrain: boolean;
}> {
  const result = await query(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN used_in_training = FALSE THEN 1 ELSE 0 END) as unused,
       SUM(CASE WHEN final_label = 0 THEN 1 ELSE 0 END) as label0,
       SUM(CASE WHEN final_label = 1 THEN 1 ELSE 0 END) as label1
     FROM training_events
     WHERE tenant_id = $1`,
    [tenantId]
  );

  const row = result.rows[0];
  const unused = parseInt(row.unused || '0');

  return {
    total: parseInt(row.total || '0'),
    unused,
    label0: parseInt(row.label0 || '0'),
    label1: parseInt(row.label1 || '0'),
    threshold: RETRAIN_THRESHOLD,
    readyToRetrain: unused >= RETRAIN_THRESHOLD,
  };
}
