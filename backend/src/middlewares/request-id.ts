import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request ID Middleware
 * Assigns unique request ID for tracing across services.
 */
export async function requestIdPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    const requestId =
      (request.headers['x-request-id'] as string) || uuidv4();
    (request as any).requestId = requestId;
    reply.header('x-request-id', requestId);
  });

  // Inject requestId into pino log context
  app.addHook('preHandler', async (request) => {
    request.log = request.log.child({ requestId: (request as any).requestId });
  });
}
