import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middlewares/auth';
import { query } from '../db/connection';
import axios from 'axios';
import { config } from '../config';
import { cacheGetOrSet } from '../services/cache/redis';
import { generateWeeklySnapshot } from '../services/performance-tracker';
import { getTrainingStats } from '../services/training/training-events';

/**
 * ML Model Transparency API
 * Exposes model metrics, confusion matrix, and threshold management.
 */
export async function mlRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', authenticate);

  // GET /ml/metrics - Current model performance metrics
  app.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    const metrics = await cacheGetOrSet('ml:metrics', async () => {
      // Try DB first
      const modelResult = await query(
        `SELECT version, model_type, accuracy, precision_score, recall, f1_score, auc_roc,
                training_samples, feature_count, feature_importance, trained_at, activated_at
         FROM model_versions WHERE is_active = true LIMIT 1`
      );

      let modelInfo: any = null;
      let performance: any = null;
      let featureImportance: Array<{ feature: string; importance: number }> = [];

      if (modelResult.rows.length > 0) {
        const model = modelResult.rows[0];
        modelInfo = {
          version: model.version,
          model_type: model.model_type,
          trained_at: model.trained_at,
          training_samples: parseInt(model.training_samples) || null,
          feature_count: parseInt(model.feature_count) || null,
        };
        performance = {
          accuracy: parseFloat(model.accuracy) || null,
          precision: parseFloat(model.precision_score) || null,
          recall: parseFloat(model.recall) || null,
          f1_score: parseFloat(model.f1_score) || null,
          auc_roc: parseFloat(model.auc_roc) || null,
        };
        // Convert feature_importance object to sorted array
        const fi = model.feature_importance || {};
        const total = Object.values(fi).reduce((s: number, v) => s + Math.abs(parseFloat(v as string) || 0), 0);
        featureImportance = Object.entries(fi)
          .map(([feature, imp]) => ({ feature, importance: total > 0 ? parseFloat(imp as string) / total : 0 }))
          .sort((a, b) => b.importance - a.importance)
          .slice(0, 20);
      } else {
        // Fallback: pull model info from ML microservice
        try {
          const mlRes = await axios.get(`${config.ml.serviceUrl}/model/info`, { timeout: 5000 });
          const info = mlRes.data;
          modelInfo = {
            version: info.version,
            model_type: info.model_type || 'XGBoost Ensemble',
            trained_at: info.trained_at || null,
            training_samples: info.training_samples || null,
            feature_count: info.feature_count || null,
          };
          performance = {
            accuracy: info.accuracy || null,
            precision: info.precision || null,
            recall: info.recall || null,
            f1_score: info.f1 || null,
            auc_roc: info.auc_roc || null,
          };
        } catch {
          return { active: false, message: 'No active model' };
        }
      }

      // Get scoring stats from last 7 days
      const statsResult = await query(
        `SELECT
          COUNT(*) as total_scored,
          ROUND(AVG(final_score)::numeric, 2) as avg_score,
          ROUND(AVG(scoring_duration_ms)::numeric, 0) as avg_scoring_ms,
          ROUND(AVG(ml_score)::numeric, 2) as avg_ml_score
         FROM fraud_scores WHERE scored_at >= NOW() - INTERVAL '7 days'`
      );

      return {
        active: true,
        model_info: modelInfo,
        performance,
        feature_importance: featureImportance,
        recent_stats: statsResult.rows[0],
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
      true_positives: tp,
      true_negatives: tn,
      false_positives: fp,
      false_negatives: fn,
      total: total,
      accuracy: Math.round(accuracy * 10000) / 100,
      precision: Math.round(precision * 10000) / 100,
      recall: Math.round(recall * 10000) / 100,
      f1_score: Math.round(f1 * 10000) / 100,
      threshold: parseFloat(threshold),
      period: `${days} days`,
      score_distribution: distResult.rows[0],
    });
  });

  // POST /ml/threshold - Update scoring thresholds
  app.post('/threshold', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId;
    const body = request.body as any;
    // Accept both camelCase and snake_case for compatibility
    const blockThreshold = body.blockThreshold ?? body.block_threshold;
    const verifyThreshold = body.verifyThreshold ?? body.verify_threshold;

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

  // GET /ml/training-stats - Real-world training data progress
  // Shows how many real labeled outcomes exist vs threshold needed for retraining
  app.get('/training-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = request.tenantId!;
    const stats = await getTrainingStats(tenantId);

    // Get last retrain job info
    const lastRetrain = await query(
      `SELECT status, new_model_version, new_f1, promoted, completed_at, triggered_by
       FROM retrain_jobs
       ORDER BY created_at DESC LIMIT 1`
    );

    return reply.send({
      ...stats,
      last_retrain: lastRetrain.rows[0] || null,
    });
  });

  // GET /ml/retrain-jobs - Retraining history
  app.get('/retrain-jobs', async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await query(
      `SELECT id, triggered_by, status, total_events, new_events_count,
              class_0_count, class_1_count, previous_model_version, new_model_version,
              previous_f1, new_f1, promoted, promotion_reason, rejection_reason,
              started_at, completed_at, error_message, created_at
       FROM retrain_jobs
       ORDER BY created_at DESC
       LIMIT 20`
    );
    return reply.send({ jobs: result.rows });
  });
}
