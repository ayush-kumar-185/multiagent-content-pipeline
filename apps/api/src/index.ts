import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { buildServer } from './server.js';
import { createDatabase } from './db/index.js';
import { createPostgresCheckpointer } from './checkpointer/index.js';
import { RunEventBus } from './events/eventBus.js';
import { createRedisConnection, createRunQueue, createRunWorker } from './queue/index.js';

export { buildServer } from './server.js';
export * from './db/index.js';
export * from './events/eventBus.js';
export * from './queue/index.js';
export * from './checkpointer/index.js';
export * from './auth/index.js';

const isMainModule =
  Boolean(process.argv[1]) &&
  (fileURLToPath(import.meta.url) === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`);

if (process.env.NODE_ENV !== 'test' && isMainModule) {
  const dbCtx = createDatabase();
  const cpCtx = createPostgresCheckpointer(dbCtx.pool);
  const eventBus = new RunEventBus(dbCtx);
  const redis = createRedisConnection();
  const queue = createRunQueue(redis);

  // Initialize Postgres checkpointer tables
  await cpCtx.setup();

  // Initialize background worker
  const worker = createRunWorker({
    dbCtx,
    checkpointer: cpCtx.checkpointer,
    eventBus,
    redis,
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
    console.log('Shutting down server and worker...');
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
