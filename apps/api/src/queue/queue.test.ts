import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import {
  createDatabase,
  DatabaseContext,
  users,
  runs,
  runEvents,
  draftVersions,
} from '../db/index.js';
import { createPostgresCheckpointer } from '../checkpointer/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { createRunQueue, createRunWorker, RunJobData } from './index.js';
import { Queue, Worker, QueueEvents } from 'bullmq';

describe('BullMQ Queue and Worker Execution', () => {
  let dbCtx: DatabaseContext;
  let checkpointer: ReturnType<typeof createPostgresCheckpointer>['checkpointer'];
  let eventBus: RunEventBus;
  let redis: Redis;
  let queue: Queue<RunJobData>;
  let worker: Worker<RunJobData>;
  let queueEvents: QueueEvents;

  const testUserId = `test-user-queue-${Date.now()}`;

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

    worker = createRunWorker({
      dbCtx,
      checkpointer,
      eventBus,
      redis,
    });
    await worker.waitUntilReady();

    await dbCtx.db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@example.com`,
      name: 'Queue Tester',
    });
  });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await queue.close();
    await redis.quit();
    await dbCtx.close();
  });

  it('processes run job to awaiting_review and resumes to approved', async () => {
    const runId = `test-queue-run-${Date.now()}`;

    // 1. Create run record in DB
    await dbCtx.db.insert(runs).values({
      id: runId,
      userId: testUserId,
      topic: 'Queue and Worker Async Orchestration',
      config: {
        audience: 'engineers',
        tone: 'technical',
        targetWords: 300,
      },
      status: 'pending',
    });

    // 2. Add job to queue
    const job = await queue.add('start-run', {
      runId,
      action: 'start',
    });

    // 3. Wait for job to complete (pauses at awaiting_review)
    await job.waitUntilFinished(queueEvents);

    // Verify DB run state is awaiting_review
    const [runAfterStart] = await dbCtx.db.select().from(runs).where(eq(runs.id, runId));
    expect(runAfterStart!.status).toBe('awaiting_review');
    expect(runAfterStart!.draft.length).toBeGreaterThan(0);
    expect(runAfterStart!.claims.length).toBeGreaterThan(0);

    // Verify draft version was recorded
    const versions = await dbCtx.db
      .select()
      .from(draftVersions)
      .where(eq(draftVersions.runId, runId));
    expect(versions.length).toBeGreaterThan(0);

    // Verify events were emitted
    const events = await dbCtx.db.select().from(runEvents).where(eq(runEvents.runId, runId));
    expect(events.length).toBeGreaterThan(0);
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('status_change');
    expect(eventTypes).toContain('review_ready');

    // 4. Resume the run with approve
    const resumeJob = await queue.add('resume-run', {
      runId,
      action: 'resume',
      resumePayload: {
        action: 'approve',
      },
    });

    await resumeJob.waitUntilFinished(queueEvents);

    // Verify DB run state is approved
    const [runAfterResume] = await dbCtx.db.select().from(runs).where(eq(runs.id, runId));
    expect(runAfterResume!.status).toBe('approved');

    // Verify run_completed event was recorded
    const finalEvents = await dbCtx.db.select().from(runEvents).where(eq(runEvents.runId, runId));
    const finalEventTypes = finalEvents.map((e) => e.type);
    expect(finalEventTypes).toContain('run_completed');
  }, 15000);
});
