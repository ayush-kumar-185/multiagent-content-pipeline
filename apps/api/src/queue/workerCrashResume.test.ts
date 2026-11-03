import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { Queue, QueueEvents } from 'bullmq';
import { createDatabase, DatabaseContext, users, runs } from '../db/index.js';
import { createPostgresCheckpointer } from '../checkpointer/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { createRunQueue, createRunWorker, RunJobData } from './index.js';

describe('Worker Crash and Checkpoint Resumption', () => {
  let dbCtx: DatabaseContext;
  let checkpointer: ReturnType<typeof createPostgresCheckpointer>['checkpointer'];
  let eventBus: RunEventBus;
  let redis: Redis;
  let queue: Queue<RunJobData>;
  let queueEvents: QueueEvents;

  const testUserId = `test-user-crash-${Date.now()}`;

  beforeAll(async () => {
    dbCtx = createDatabase();
    const cpCtx = createPostgresCheckpointer(dbCtx.pool);
    await cpCtx.setup();
    checkpointer = cpCtx.checkpointer;
    eventBus = new RunEventBus(dbCtx);

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

    queue = createRunQueue(redis);
    queueEvents = new QueueEvents(queue.name, { connection: redis });
    await queueEvents.waitUntilReady();

    await dbCtx.db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@example.com`,
      name: 'Crash Tester',
    });
  });

  afterAll(async () => {
    await queueEvents.close();
    await queue.close();
    await redis.quit();
    await dbCtx.close();
  });

  it('worker 1 starts run and is killed; worker 2 boots up and resumes from checkpoint', async () => {
    const runId = `crash-resume-${Date.now()}`;

    await dbCtx.db.insert(runs).values({
      id: runId,
      userId: testUserId,
      topic: 'Worker Crash Resilience',
      config: {
        audience: 'engineers',
        tone: 'technical',
        targetWords: 300,
      },
      status: 'pending',
    });

    // 1. Boot Worker 1
    const worker1 = createRunWorker({
      dbCtx,
      checkpointer,
      eventBus,
      redis,
    });
    await worker1.waitUntilReady();

    // 2. Start run job
    const job = await queue.add('start-run', { runId, action: 'start' });
    await job.waitUntilFinished(queueEvents);

    const [runMidState] = await dbCtx.db.select().from(runs).where(eq(runs.id, runId));
    expect(runMidState!.status).toBe('awaiting_review');

    // 3. Kill Worker 1 (simulate process death/worker termination)
    await worker1.close();

    // 4. Boot Worker 2 (simulate process restart on new machine or pod)
    const worker2 = createRunWorker({
      dbCtx,
      checkpointer,
      eventBus,
      redis,
    });
    await worker2.waitUntilReady();

    // 5. Submit resume command
    const resumeJob = await queue.add('resume-run', {
      runId,
      action: 'resume',
      resumePayload: {
        action: 'approve',
      },
    });

    await resumeJob.waitUntilFinished(queueEvents);

    // 6. Verify Worker 2 completed the run using the persistent Postgres checkpoint
    const [finalRun] = await dbCtx.db.select().from(runs).where(eq(runs.id, runId));
    expect(finalRun!.status).toBe('approved');

    await worker2.close();
  }, 20000);
});
