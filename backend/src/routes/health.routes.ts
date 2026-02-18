import { FastifyInstance } from 'fastify';
import { getPool } from '../db/connection';
import { getRedis } from '../services/cache/redis';
import { register } from '../services/metrics';
import { scoringQueue } from '../services/queue/scoring-queue';

/**
 * Health / Readiness / Liveness + Metrics endpoints
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Basic health (always responds if process is alive)
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime(),
  }));

  // Liveness probe (is the process alive?)
  app.get('/live', async () => ({
    status: 'ok',
    pid: process.pid,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  }));

  // Readiness probe (can we handle traffic?)
  app.get('/ready', async (_request, reply) => {
    const checks: Record<string, { status: string; latency?: number }> = {};

    // Check PostgreSQL
    const dbStart = Date.now();
    try {
      const pool = getPool();
      await pool.query('SELECT 1');
      checks.postgres = { status: 'up', latency: Date.now() - dbStart };
    } catch {
      checks.postgres = { status: 'down', latency: Date.now() - dbStart };
    }

    // Check Redis
    const redisStart = Date.now();
    try {
      const redis = await getRedis();
      await redis.ping();
      checks.redis = { status: 'up', latency: Date.now() - redisStart };
    } catch {
      checks.redis = { status: 'down', latency: Date.now() - redisStart };
    }

    // Check Queue
    try {
      const waiting = await scoringQueue.getWaitingCount();
      const active = await scoringQueue.getActiveCount();
      checks.queue = { status: 'up', latency: 0 };
      (checks.queue as any).waiting = waiting;
      (checks.queue as any).active = active;
    } catch {
      checks.queue = { status: 'down' };
    }

    const allUp = Object.values(checks).every((c) => c.status === 'up');

    return reply.code(allUp ? 200 : 503).send({
      status: allUp ? 'ready' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
    });
  });

  // Prometheus metrics endpoint
  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', register.contentType);
    return register.metrics();
  });
}
