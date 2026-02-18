import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middlewares/auth';
import { query } from '../db/connection';
import axios from 'axios';
import { config } from '../config';
import { cacheGetOrSet } from '../services/cache/redis';
import { generateWeeklySnapshot } from '../services/performance-tracker';

/**
 * ML Model Transparency API
 * Exposes model metrics, confusion matrix, and threshold management.
 */
export async function mlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // GET /ml/metrics - Current model performance metrics
  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    const metrics = await cacheGetOrSet('ml:metrics', async () => {
      // Get active model from DB
      const modelResult = await query(
        `SELECT version, model_type, accuracy, precision_score, recall, f1_score, auc_roc,
                training_samples, feature_count, feature_importance, trained_at, activated_at
         FROM model_versions WHERE is_active = true LIMIT 1`
      );

      if (modelResult.rows.length === 0) {
        return { active: false, message: 'No active model' };
      }

      const model = modelResult.rows[0];

      // Get scoring stats from last 7 days
      const statsResult = await query(
        `SELECT
          COUNT(*) as total_scored,
          ROUND(AVG(final_score)::numeric, 2) as avg_score,
          ROUND(AVG(scoring_duration_ms)::numeric, 0) as avg_scoring_ms,
          ROUND(AVG(ml_score)::numeric, 2) as avg_ml_score,
          COUNT(*) FILTER (WHERE ml_model_version = $1) as using_current_model
         FROM fraud_scores WHERE scored_at >= NOW() - INTERVAL '7 days'`,
        [model.version]
      );

      return {
        active: true,
        model: {
          version: model.version,
          type: model.model_type,
          trainedAt: model.trained_at,
          activatedAt: model.activated_at,
          trainingSamples: model.training_samples,
          featureCount: model.feature_count,
        },
        performance: {
          accuracy: parseFloat(model.accuracy) || null,
          precision: parseFloat(model.precision_score) || null,
          recall: parseFloat(model.recall) || null,
          f1Score: parseFloat(model.f1_score) || null,
          aucRoc: parseFloat(model.auc_roc) || null,
        },
        featureImportance: model.feature_importance || {},
        recentStats: statsResult.rows[0],
      };
    }, 120);

    return reply.send(metrics);
  });

  // GET /ml/confusion-matrix - Actual vs Predicted analysis
  app.get('/confusion-matrix', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId;
    const { days = '30', threshold = '70' } = request.query as any;

    const matrix = await query(
      `SELECT
        -- True Positives: predicted BLOCK and actually was RTO
        COUNT(*) FILTER (WHERE o.recommendation = 'BLOCK' AND o.status = 'rto') as true_positive,
        -- True Negatives: predicted APPROVE and was delivered
        COUNT(*) FILTER (WHERE o.recommendation = 'APPROVE' AND o.status = 'delivered') as true_negative,
        -- False Positives: predicted BLOCK but was delivered (lost sales)
        COUNT(*) FILTER (WHERE o.recommendation = 'BLOCK' AND o.status = 'delivered') as false_positive,
        -- False Negatives: predicted APPROVE but was RTO (fraud missed)
        COUNT(*) FILTER (WHERE o.recommendation = 'APPROVE' AND o.status = 'rto') as false_negative,
        -- Total with outcome
        COUNT(*) FILTER (WHERE o.status IN ('delivered', 'rto')) as total_with_outcome
       FROM orders o
       WHERE o.tenant_id = $1
         AND o.created_at >= NOW() - INTERVAL '1 day' * $2
         AND o.status IN ('delivered', 'rto')`,
      [tenantId, parseInt(days)]
    );

    const m = matrix.rows[0];
    const tp = parseInt(m.true_positive) || 0;
    const tn = parseInt(m.true_negative) || 0;
    const fp = parseInt(m.false_positive) || 0;
    const fn = parseInt(m.false_negative) || 0;
    const total = tp + tn + fp + fn;

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    const accuracy = total > 0 ? (tp + tn) / total : 0;

    // Score distribution at threshold
    const distResult = await query(
      `SELECT
        COUNT(*) FILTER (WHERE risk_score >= $2) as above_threshold,
        COUNT(*) FILTER (WHERE risk_score < $2) as below_threshold,
        ROUND(AVG(risk_score) FILTER (WHERE status = 'rto')::numeric, 2) as avg_rto_score,
        ROUND(AVG(risk_score) FILTER (WHERE status = 'delivered')::numeric, 2) as avg_delivered_score
       FROM orders
       WHERE tenant_id = $1 AND status IN ('delivered', 'rto')
         AND created_at >= NOW() - INTERVAL '1 day' * $3`,
      [tenantId, parseFloat(threshold), parseInt(days)]
    );

    return reply.send({
      confusionMatrix: { truePositive: tp, trueNegative: tn, falsePositive: fp, falseNegative: fn },
      metrics: {
        accuracy: Math.round(accuracy * 10000) / 100,
        precision: Math.round(precision * 10000) / 100,
        recall: Math.round(recall * 10000) / 100,
        f1Score: Math.round(f1 * 10000) / 100,
      },
      threshold: parseFloat(threshold),
      totalWithOutcome: total,
      scoreDistribution: distResult.rows[0],
      period: `${days} days`,
    });
  });

  // POST /ml/threshold - Update scoring thresholds
  app.post('/threshold', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId;
    const { blockThreshold, verifyThreshold } = request.body as any;

    if (blockThreshold !== undefined && (blockThreshold < 0 || blockThreshold > 100)) {
      return reply.code(400).send({ error: 'blockThreshold must be 0-100' });
    }
    if (verifyThreshold !== undefined && (verifyThreshold < 0 || verifyThreshold > 100)) {
      return reply.code(400).send({ error: 'verifyThreshold must be 0-100' });
    }
    if (blockThreshold !== undefined && verifyThreshold !== undefined && verifyThreshold >= blockThreshold) {
      return reply.code(400).send({ error: 'verifyThreshold must be less than blockThreshold' });
    }

    const settings: Record<string, number> = {};
    if (blockThreshold !== undefined) settings.blockThreshold = blockThreshold;
    if (verifyThreshold !== undefined) settings.verifyThreshold = verifyThreshold;

    await query(
      `UPDATE tenants SET
        settings = settings || $1::jsonb,
        updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(settings), tenantId]
    );

    return reply.send({
      success: true,
      thresholds: settings,
      message: 'Thresholds updated. New orders will use these thresholds.',
    });
  });

  // GET /ml/versions - List all model versions
  app.get('/versions', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await query(
      `SELECT version, model_type, accuracy, precision_score, recall, f1_score, auc_roc,
              training_samples, is_active, trained_at
       FROM model_versions ORDER BY trained_at DESC LIMIT 20`
    );
    return reply.send({ versions: result.rows });
  });

  // GET /ml/performance-history - Last 12 weekly snapshots
  app.get('/performance-history', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId;

    const result = await query(
      `SELECT * FROM performance_snapshots
       WHERE tenant_id = $1
       ORDER BY period_start DESC
       LIMIT 12`,
      [tenantId]
    );

    return reply.send({ snapshots: result.rows });
  });

  // POST /ml/generate-snapshot - Manually trigger snapshot generation
  app.post('/generate-snapshot', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId;

    const snapshot = await generateWeeklySnapshot(tenantId);

    return reply.send({ success: true, snapshot });
  });

  // GET /ml/health - ML service health
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const response = await axios.get(`${config.ml.serviceUrl}/health`, { timeout: 3000 });
      return reply.send({
        mlService: 'up',
        ...response.data,
      });
    } catch {
      return reply.code(503).send({ mlService: 'down', error: 'ML service unreachable' });
    }
  });
}
