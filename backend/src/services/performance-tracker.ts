import { query } from '../db/connection';

/**
 * Generate a weekly performance snapshot for a tenant.
 * Looks at orders from the last 7 days that have delivery outcomes.
 */
export async function generateWeeklySnapshot(tenantId: string): Promise<any> {
  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 7);

  const result = await query(
    `SELECT
      COUNT(*) FILTER (WHERE status IN ('delivered', 'rto', 'approved', 'blocked', 'verified')) as total_orders,
      COUNT(*) FILTER (WHERE recommendation = 'BLOCK') as total_blocked,
      COUNT(*) FILTER (WHERE recommendation = 'APPROVE') as total_approved,
      COUNT(*) FILTER (WHERE recommendation = 'VERIFY') as total_verified,
      COUNT(*) FILTER (WHERE recommendation = 'BLOCK' AND status = 'rto') as blocked_rto,
      COUNT(*) FILTER (WHERE recommendation = 'BLOCK' AND status = 'delivered') as blocked_delivered,
      COUNT(*) FILTER (WHERE recommendation = 'APPROVE' AND status = 'rto') as approved_rto,
      COUNT(*) FILTER (WHERE recommendation = 'APPROVE' AND status = 'delivered') as approved_delivered,
      ROUND(AVG(risk_score)::numeric, 2) as avg_risk_score
    FROM orders
    WHERE tenant_id = $1
      AND created_at >= $2
      AND created_at <= $3
      AND status IN ('delivered', 'rto', 'approved', 'blocked', 'verified')`,
    [tenantId, periodStart.toISOString(), periodEnd.toISOString()]
  );

  const row = result.rows[0];
  const blockedRto = parseInt(row.blocked_rto) || 0;
  const blockedDelivered = parseInt(row.blocked_delivered) || 0;
  const approvedRto = parseInt(row.approved_rto) || 0;
  const totalBlocked = blockedRto + blockedDelivered;
  const totalActualRto = blockedRto + approvedRto;

  const precisionAtBlock = totalBlocked > 0 ? blockedRto / totalBlocked : null;
  const recall = totalActualRto > 0 ? blockedRto / totalActualRto : null;
  const f1 = precisionAtBlock !== null && recall !== null && (precisionAtBlock + recall) > 0
    ? (2 * precisionAtBlock * recall) / (precisionAtBlock + recall)
    : null;

  // Get active model version
  const modelResult = await query(
    `SELECT version FROM model_versions WHERE is_active = true LIMIT 1`
  );
  const modelVersion = modelResult.rows[0]?.version || null;

  const insertResult = await query(
    `INSERT INTO performance_snapshots
      (tenant_id, period_start, period_end, period_type,
       total_orders, total_blocked, total_approved, total_verified,
       blocked_rto, blocked_delivered, approved_rto, approved_delivered,
       precision_at_block, recall, f1_score, avg_risk_score, model_version)
    VALUES ($1, $2, $3, 'weekly', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    ON CONFLICT (tenant_id, period_start, period_type)
    DO UPDATE SET
      period_end = EXCLUDED.period_end,
      total_orders = EXCLUDED.total_orders,
      total_blocked = EXCLUDED.total_blocked,
      total_approved = EXCLUDED.total_approved,
      total_verified = EXCLUDED.total_verified,
      blocked_rto = EXCLUDED.blocked_rto,
      blocked_delivered = EXCLUDED.blocked_delivered,
      approved_rto = EXCLUDED.approved_rto,
      approved_delivered = EXCLUDED.approved_delivered,
      precision_at_block = EXCLUDED.precision_at_block,
      recall = EXCLUDED.recall,
      f1_score = EXCLUDED.f1_score,
      avg_risk_score = EXCLUDED.avg_risk_score,
      model_version = EXCLUDED.model_version
    RETURNING *`,
    [
      tenantId,
      periodStart.toISOString().split('T')[0],
      periodEnd.toISOString().split('T')[0],
      parseInt(row.total_orders) || 0,
      parseInt(row.total_blocked) || 0,
      parseInt(row.total_approved) || 0,
      parseInt(row.total_verified) || 0,
      blockedRto,
      blockedDelivered,
      approvedRto,
      parseInt(row.approved_delivered) || 0,
      precisionAtBlock !== null ? precisionAtBlock.toFixed(4) : null,
      recall !== null ? recall.toFixed(4) : null,
      f1 !== null ? f1.toFixed(4) : null,
      parseFloat(row.avg_risk_score) || null,
      modelVersion,
    ]
  );

  return insertResult.rows[0];
}

/**
 * Generate snapshots for all active tenants.
 */
export async function generateAllSnapshots(): Promise<void> {
  const tenants = await query(`SELECT id FROM tenants WHERE is_active = true`);
  for (const tenant of tenants.rows) {
    try {
      await generateWeeklySnapshot(tenant.id);
      console.log(`Performance snapshot generated for tenant ${tenant.id}`);
    } catch (err) {
      console.error(`Failed to generate snapshot for tenant ${tenant.id}:`, err);
    }
  }
}
