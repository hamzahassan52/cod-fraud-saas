import { FastifyInstance } from 'fastify';
import { httpRequestDuration, httpRequestTotal, errorTotal } from '../services/metrics';

/**
 * Metrics Middleware
 * Tracks HTTP request duration and counts for Prometheus.
 */
export async function metricsPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request) => {
    (request as any).__startTime = process.hrtime.bigint();
  });

  app.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).__startTime as bigint;
    if (!startTime) return;

    const durationNs = Number(process.hrtime.bigint() - startTime);
    const durationSec = durationNs / 1e9;

    // Normalize route for cardinality control
    const route = request.routeOptions?.url || request.url.split('?')[0];
    const tenantId = (request as any).tenantId || 'unknown';

    httpRequestDuration.observe(
      {
        method: request.method,
        route,
        status_code: reply.statusCode.toString(),
        tenant_id: tenantId,
      },
      durationSec
    );

    httpRequestTotal.inc({
      method: request.method,
      route,
      status_code: reply.statusCode.toString(),
    });
  });

  app.addHook('onError', async (_request, _reply, error) => {
    const type = (error as any).statusCode >= 500 ? 'internal' : 'validation';
    errorTotal.inc({ type });
  });
}
