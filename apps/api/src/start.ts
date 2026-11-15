import dotenv from 'dotenv';
import path from 'node:path';

// Ensure canonical root monorepo .env is loaded first
dotenv.config({ path: path.resolve(process.cwd(), '../../.env'), override: true });
dotenv.config({ path: path.resolve(process.cwd(), '../.env'), override: true });
dotenv.config({ override: true });

import { validateStartupEnvironment } from './config/mode.js';
import { createDatabase } from './db/index.js';
import { createPostgresCheckpointer } from './checkpointer/index.js';
import { RunEventBus } from './events/eventBus.js';
import { createRedisConnection, createRunQueue, createRunWorker } from './queue/index.js';
import { buildServer } from './server.js';

async function startServer(): Promise<void> {
  // Validate explicit real vs mock mode at startup
  const envStatus = validateStartupEnvironment();
  console.log(`[CiteWriter API] Execution Mode: ${envStatus.mode.toUpperCase()}`);

  const dbCtx = createDatabase();
  const cpCtx = createPostgresCheckpointer(dbCtx.pool);
  const eventBus = new RunEventBus(dbCtx);
  const redis = createRedisConnection();
  const queue = createRunQueue(redis);

  // Initialize Postgres checkpointer tables
  await cpCtx.setup();

  const isReal = envStatus.mode === 'real';
  if (isReal) {
    const { getAgentModel, resolveProvider } = await import('@citewriter/core');
    console.log(`[CiteWriter API] Researcher:   ${resolveProvider({ role: 'researcher' })} / ${getAgentModel('researcher')}`);
    console.log(`[CiteWriter API] Writer:       ${resolveProvider({ role: 'writer' })} / ${getAgentModel('writer')}`);
    console.log(`[CiteWriter API] Fact-Checker: ${resolveProvider({ role: 'factChecker' })} / ${getAgentModel('factChecker')}`);
    console.log(`[CiteWriter API] Editor:       ${resolveProvider({ role: 'editor' })} / ${getAgentModel('editor')}`);
  }

  // Initialize background worker with real agents only when USE_REAL_LLM=true
  const worker = createRunWorker({
    dbCtx,
    checkpointer: cpCtx.checkpointer,
    eventBus,
    redis,
    graphOptions: {
      useRealResearcher: isReal,
      useRealWriter: isReal,
      useRealFactChecker: isReal,
      useRealEditor: isReal,
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
