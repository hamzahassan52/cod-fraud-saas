import { Queue, Worker, Job } from 'bullmq';
import { config } from '../../config';
import { FraudEngine } from '../fraud-engine/engine';
import { query } from '../../db/connection';
import {
  fraudScoringDuration, fraudScoringTotal,
  queueWaitTime, queueJobsProcessed
} from '../metrics';

const QUEUE_NAME = 'fraud-scoring';

const redisUrl = new URL(config.redis.url);
const connection = {
  host: redisUrl.hostname,
  port: parseInt(redisUrl.port || '6379'),
  password: redisUrl.password || undefined,
  username: redisUrl.username || undefined,
};

// Queue instance
export const scoringQueue = new Queue(QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Priority: paid plans get processed first
// BullMQ priority: lower number = higher priority
const PLAN_PRIORITY: Record<string, number> = {
  enterprise: 1,
  growth: 2,
  starter: 3,
  free: 5,
};

// Add order to scoring queue with plan-based priority
export async function enqueueScoring(
  orderId: string,
  tenantId: string,
  plan: string = 'free'
): Promise<void> {
  const priority = PLAN_PRIORITY[plan] || 5;
  await scoringQueue.add(
    'score-order',
    { orderId, tenantId, enqueuedAt: Date.now() },
    { priority }
  );
}

// Worker that processes scoring jobs
export function startScoringWorker(): Worker {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { orderId, tenantId, enqueuedAt } = job.data;

      // Track queue wait time
      if (enqueuedAt) {
        queueWaitTime.observe(Date.now() - enqueuedAt);
      }

      const orderResult = await query(
        `SELECT * FROM orders WHERE id = $1 AND tenant_id = $2`,
        [orderId, tenantId]
      );

      if (orderResult.rows.length === 0) {
        throw new Error(`Order ${orderId} not found`);
      }

      const order = orderResult.rows[0];
      const engine = new FraudEngine(tenantId);
      const result = await engine.scoreOrder(order);

      // Update order with score
      await query(
        `UPDATE orders SET
          risk_score = $1,
          risk_level = $2,
          recommendation = $3,
          fraud_signals = $4,
          recommendation_reasons = $5,
          risk_summary = $6,
          status = 'scored',
          scored_at = NOW()
        WHERE id = $7`,
        [
          result.riskScore,
          result.riskLevel,
          result.recommendation,
          JSON.stringify(result.signals),
          JSON.stringify(result.recommendationReasons),
          result.riskSummary,
          orderId,
        ]
      );

      // Insert fraud score breakdown
      await query(
        `INSERT INTO fraud_scores
          (order_id, tenant_id, rule_score, statistical_score, ml_score, final_score, confidence, signals, ml_features, ml_model_version, scoring_duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          orderId,
          tenantId,
          result.scoring.ruleScore,
          result.scoring.statisticalScore,
          result.scoring.mlScore,
          result.riskScore,
          result.confidence,
          JSON.stringify(result.signals),
          JSON.stringify(result.mlFeatures || {}),
          result.modelVersion || null,
          result.durationMs,
        ]
      );

      // Insert prediction log (full ML audit trail)
      await query(
        `INSERT INTO prediction_logs
          (order_id, tenant_id, risk_score, recommendation, rule_score, statistical_score, ml_score,
           ml_model_version, ml_top_factors, recommendation_reasons, risk_summary, confidence, scoring_duration_ms)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          orderId,
          tenantId,
          result.riskScore,
          result.recommendation,
          result.scoring.ruleScore,
          result.scoring.statisticalScore,
          result.scoring.mlScore,
          result.modelVersion || null,
          JSON.stringify(
            (result.signals || [])
              .filter((s: any) => s.layer === 'ml')
              .map((s: any) => ({ feature: s.signal, score: s.score, description: s.description }))
          ),
          JSON.stringify(result.recommendationReasons || []),
          result.riskSummary || null,
          result.confidence,
          result.durationMs,
        ]
      );

      // Log the scoring action
      await query(
        `INSERT INTO risk_logs (tenant_id, order_id, action, actor_type, new_state)
        VALUES ($1, $2, 'scored', 'system', $3)`,
        [tenantId, orderId, JSON.stringify({ score: result.riskScore, recommendation: result.recommendation })]
      );

      return result;
    },
    {
      connection,
      concurrency: config.queue.concurrency,
      limiter: { max: 50, duration: 1000 },
    }
  );

  worker.on('completed', (job) => {
    queueJobsProcessed.inc({ status: 'completed' });
    console.log(`Scoring completed for order ${job.data.orderId}`);
  });

  worker.on('failed', (job, err) => {
    queueJobsProcessed.inc({ status: 'failed' });
    console.error(`Scoring failed for order ${job?.data.orderId}:`, err.message);
  });

  return worker;
}
