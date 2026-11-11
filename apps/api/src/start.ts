import dotenv from 'dotenv';
import path from 'node:path';

// Ensure root monorepo .env is loaded
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { hasConfiguredLLM } from '@citewriter/core';
import { createDatabase } from './db/index.js';
import { createPostgresCheckpointer } from './checkpointer/index.js';
import { RunEventBus } from './events/eventBus.js';
import { createRedisConnection, createRunQueue, createRunWorker } from './queue/index.js';
import { buildServer } from './server.js';

async function startServer(): Promise<void> {
  const dbCtx = createDatabase();
  const cpCtx = createPostgresCheckpointer(dbCtx.pool);
  const eventBus = new RunEventBus(dbCtx);
  const redis = createRedisConnection();
  const queue = createRunQueue(redis);

  // Initialize Postgres checkpointer tables
  await cpCtx.setup();

  const hasLLMKey = hasConfiguredLLM();

  // Initialize background worker with real agents when LLM credentials are present
  const worker = createRunWorker({
    dbCtx,
    checkpointer: cpCtx.checkpointer,
    eventBus,
    redis,
    graphOptions: {
      useRealResearcher: hasLLMKey,
      useRealWriter: hasLLMKey,
      useRealFactChecker: hasLLMKey,
      useRealEditor: hasLLMKey,
    },
  });

  const server = buildServer({
    dbCtx,
    eventBus,
    queue,
    redis,
  });

  const port = Number(process.env.PORT) || 3001;
  server.listen({ port, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    console.log(`CiteWriter API server listening on ${address}`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down CiteWriter API server and worker...');
    await worker.close();
    await queue.close();
    await redis.quit();
    await dbCtx.close();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

startServer().catch((err) => {
  console.error('Fatal error starting CiteWriter API server:', err);
  process.exit(1);
});
