import Fastify, { FastifyInstance } from 'fastify';
import { CITEWRITER_CORE_VERSION } from '@citewriter/core';

export function buildServer(): FastifyInstance {
  const app = Fastify({
    logger: false,
  });

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'citewriter-api',
      coreVersion: CITEWRITER_CORE_VERSION,
      timestamp: new Date().toISOString(),
    };
  });

  return app;
}

if (process.env.NODE_ENV !== 'test' && import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  const port = Number(process.env.PORT) || 3001;
  server.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`CiteWriter API server listening on ${address}`);
  });
}
