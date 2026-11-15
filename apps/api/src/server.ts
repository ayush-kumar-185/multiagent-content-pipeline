import Fastify, { FastifyInstance, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { CITEWRITER_CORE_VERSION } from '@citewriter/core';
import { createDatabase, DatabaseContext } from './db/index.js';
import { RunEventBus } from './events/eventBus.js';
import { createRunQueue, createRedisConnection, RunJobData } from './queue/index.js';
import { createAuthMiddleware } from './auth/index.js';
import { registerRunRoutes } from './routes/runs.js';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export interface ServerOptions {
  dbCtx?: DatabaseContext;
  eventBus?: RunEventBus;
  queue?: Queue<RunJobData>;
  redis?: Redis;
  maxConcurrentRunsPerUser?: number;
  accessCode?: string;
}

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    bodyLimit: 1048576, // 1 MB request body limit to prevent denial of service
  });

  // Global structured error handler
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const statusCode = error.statusCode ?? 500;
    let code = error.code ?? 'INTERNAL_SERVER_ERROR';

    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      code = 'PAYLOAD_TOO_LARGE';
    } else if (statusCode === 429) {
      code = 'RATE_LIMIT_EXCEEDED';
    }

    reply.status(statusCode).send({
      error: {
        code,
        message: error.message,
        statusCode,
      },
    });
  });

  // Global structured 404 handler
  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
        statusCode: 404,
      },
    });
  });

  // Database, checkpointer, events & queue
  const dbCtx = options.dbCtx ?? createDatabase();
  const eventBus = options.eventBus ?? new RunEventBus(dbCtx);
  const redis = options.redis ?? createRedisConnection();
  const queue = options.queue ?? createRunQueue(redis);

  // Gracefully close resources created by buildServer when app closes
  app.addHook('onClose', async () => {
    if (!options.queue) {
      await queue.close();
    }
    if (!options.redis) {
      await redis.quit();
    }
    if (!options.dbCtx) {
      await dbCtx.close();
    }
  });

  // Plugins
  app.register(cors, {
    origin: true,
    credentials: true,
  });

  app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // Health check (liveness probe)
  app.get('/health', async () => {
    const mode = process.env.USE_REAL_LLM === 'true' ? 'real' : 'mock';
    return {
      status: 'ok',
      service: 'citewriter-api',
      mode,
      coreVersion: CITEWRITER_CORE_VERSION,
      timestamp: new Date().toISOString(),
    };
  });

  // Deep readiness check (verifies PostgreSQL and Redis connectivity)
  app.get('/health/ready', async (_request, reply) => {
    let dbStatus = 'ok';
    let redisStatus = 'ok';
    let isReady = true;

    try {
      await dbCtx.pool.query('SELECT 1');
    } catch (err) {
      dbStatus = `error: ${(err as Error).message}`;
      isReady = false;
    }

    try {
      await redis.ping();
    } catch (err) {
      redisStatus = `error: ${(err as Error).message}`;
      isReady = false;
    }

    const statusCode = isReady ? 200 : 503;
    return reply.status(statusCode).send({
      status: isReady ? 'ok' : 'degraded',
      service: 'citewriter-api',
      checks: {
        database: dbStatus,
        redis: redisStatus,
      },
      timestamp: new Date().toISOString(),
    });
  });

  // Auth middleware hook for /runs routes (verifies X-Access-Code)
  const requireAuth = createAuthMiddleware(dbCtx, { accessCode: options.accessCode });
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/runs')) {
      await requireAuth(req, reply);
    }
  });

  // Register /runs routes
  registerRunRoutes(app, {
    dbCtx,
    eventBus,
    queue,
    maxConcurrentRunsPerUser: options.maxConcurrentRunsPerUser ?? 3,
  });

  return app;
}
