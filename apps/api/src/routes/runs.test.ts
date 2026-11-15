import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { buildServer } from '../server.js';
import { createDatabase, DatabaseContext, users } from '../db/index.js';
import { createPostgresCheckpointer } from '../checkpointer/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { createRunQueue, createRunWorker, RunJobData } from '../queue/index.js';

describe('Fastify Runs API Endpoints & Auth', () => {
  let app: FastifyInstance;
  let dbCtx: DatabaseContext;
  let redis: Redis;
  let queue: Queue<RunJobData>;
  let queueEvents: QueueEvents;
  let worker: Worker<RunJobData>;
  let eventBus: RunEventBus;

  const testUserId = `api-test-user-${Date.now()}`;

  beforeAll(async () => {
    dbCtx = createDatabase();
    const cpCtx = createPostgresCheckpointer(dbCtx.pool);
    await cpCtx.setup();
    eventBus = new RunEventBus(dbCtx);

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

    const queueName = 'citewriter-runs-api-test';
    queue = createRunQueue(redis, queueName);
    queueEvents = new QueueEvents(queueName, { connection: redis });
    await queueEvents.waitUntilReady();

    worker = createRunWorker({
      dbCtx,
      checkpointer: cpCtx.checkpointer,
      eventBus,
      redis,
      queueName,
    });
    await worker.waitUntilReady();

    app = buildServer({
      dbCtx,
      eventBus,
      queue,
      redis,
      maxConcurrentRunsPerUser: 2, // Low cap for testing 429
      accessCode: 'citewriter_demo_2026',
    });
    await app.ready();

    // Create user
    await dbCtx.db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@example.com`,
      name: 'API Tester',
    });
  });

  afterAll(async () => {
    await app.close();
    await worker.close();
    await queueEvents.close();
    await queue.close();
    await redis.quit();
    await dbCtx.close();
  });

  it('rejects unauthenticated requests to /runs with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/runs',
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates a new run and enqueues job via POST /runs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: {
        'x-user-id': testUserId,
        'x-access-code': 'citewriter_demo_2026',
      },
      payload: {
        topic: 'Modern TypeScript Compilers and Build Tools',
        config: {
          targetWords: 350,
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^run_/);
    expect(body.status).toBe('pending');
    expect(body.topic).toBe('Modern TypeScript Compilers and Build Tools');

    // Wait for the worker to process the job to awaiting_review
    let retries = 30;
    let currentStatus = 'pending';
    while (retries > 0 && currentStatus !== 'awaiting_review') {
      await new Promise((r) => setTimeout(r, 200));
      const getRes = await app.inject({
        method: 'GET',
        url: `/runs/${body.id}`,
        headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
      });
      currentStatus = getRes.json().status;
      retries--;
    }

    expect(currentStatus).toBe('awaiting_review');
  });

  it('enforces per-user concurrent run limit and returns 429', async () => {
    const secondUserId = `limit-user-${Date.now()}`;
    await dbCtx.db.insert(users).values({
      id: secondUserId,
      email: `${secondUserId}@test.local`,
    });

    // Create run 1
    const res1 = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: { 'x-user-id': secondUserId, 'x-access-code': 'citewriter_demo_2026' },
      payload: { topic: 'Run 1' },
    });
    expect(res1.statusCode).toBe(201);

    // Create run 2 (reaches limit of 2)
    const res2 = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: { 'x-user-id': secondUserId, 'x-access-code': 'citewriter_demo_2026' },
      payload: { topic: 'Run 2' },
    });
    expect(res2.statusCode).toBe(201);

    // Create run 3 (should return 429)
    const res3 = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: { 'x-user-id': secondUserId, 'x-access-code': 'citewriter_demo_2026' },
      payload: { topic: 'Run 3' },
    });
    expect(res3.statusCode).toBe(429);
    expect(res3.json().message).toContain('Maximum active runs limit reached');
  });

  it('resumes an awaiting_review run via POST /runs/:id/resume', async () => {
    // 1. Create a run
    const createRes = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
      payload: { topic: 'Testing API Resumption' },
    });
    const runId = createRes.json().id;

    // 2. Wait until awaiting_review
    let status = 'pending';
    let retries = 30;
    while (retries > 0 && status !== 'awaiting_review') {
      await new Promise((r) => setTimeout(r, 200));
      const getRes = await app.inject({
        method: 'GET',
        url: `/runs/${runId}`,
        headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
      });
      status = getRes.json().status;
      retries--;
    }
    expect(status).toBe('awaiting_review');

    // 3. Call POST /runs/:id/resume with approve
    const resumeRes = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/resume`,
      headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
      payload: {
        action: 'approve',
      },
    });
    expect(resumeRes.statusCode).toBe(200);
    expect(resumeRes.json().status).toBe('resuming');

    // 4. Wait for final status 'approved'
    retries = 30;
    while (retries > 0 && status !== 'approved') {
      await new Promise((r) => setTimeout(r, 200));
      const getRes = await app.inject({
        method: 'GET',
        url: `/runs/${runId}`,
        headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
      });
      status = getRes.json().status;
      retries--;
    }
    expect(status).toBe('approved');
  });

  it('cancels a run via POST /runs/:id/cancel', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
      payload: { topic: 'Testing Cancellation' },
    });
    const runId = createRes.json().id;

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/cancel`,
      headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('canceled');

    const getRes = await app.inject({
      method: 'GET',
      url: `/runs/${runId}`,
      headers: { 'x-user-id': testUserId, 'x-access-code': 'citewriter_demo_2026' },
    });
    expect(getRes.json().status).toBe('rejected');
  });
});
