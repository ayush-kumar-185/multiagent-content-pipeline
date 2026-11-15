import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Queue, QueueEvents, Worker } from 'bullmq';
import crypto from 'node:crypto';
import { buildServer } from '../server.js';
import { createDatabase, DatabaseContext, users, runs } from '../db/index.js';
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

  const testBearerToken = `runs-token-${Date.now()}`;
  const testUserId = `user_${crypto.createHash('sha256').update(testBearerToken).digest('hex').slice(0, 16)}`;
  function authHeaders(token = testBearerToken) {
    return {
      authorization: `Bearer ${token}`,
      'x-access-code': 'citewriter_demo_2026',
    };
  }

  beforeAll(async () => {
    process.env.USE_REAL_LLM = 'false';
    process.env.MAX_CONCURRENT_RUNS = '10';
    process.env.MAX_RUNS_PER_DAY = '100';
    process.env.MAX_RUNS_PER_IP_PER_DAY = '100';

    dbCtx = createDatabase();
    await dbCtx.db.delete(runs);
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
      headers: authHeaders(),
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
        headers: authHeaders(),
      });
      currentStatus = getRes.json().status;
      retries--;
    }

    expect(currentStatus).toBe('awaiting_review');
  });

  it('enforces per-user concurrent run limit and returns 429', async () => {
    const secondBearerToken = `limit-token-${Date.now()}`;

    // Create run 1
    const res1 = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: authHeaders(secondBearerToken),
      payload: { topic: 'Run 1' },
    });
    expect(res1.statusCode).toBe(201);

    // Create run 2 (reaches limit of 2)
    const res2 = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: authHeaders(secondBearerToken),
      payload: { topic: 'Run 2' },
    });
    expect(res2.statusCode).toBe(201);

    // Create run 3 (should return 429)
    const res3 = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: authHeaders(secondBearerToken),
      payload: { topic: 'Run 3' },
    });
    expect(res3.statusCode).toBe(429);
    expect(res3.json().message).toContain('Maximum active runs limit reached');
  });

  it('resumes an awaiting_review run via POST /runs/:id/resume', async () => {
    const resumeBearerToken = `resume-token-${Date.now()}`;
    // 1. Create a run
    const createRes = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: authHeaders(resumeBearerToken),
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
        headers: authHeaders(resumeBearerToken),
      });
      status = getRes.json().status;
      retries--;
    }
    expect(status).toBe('awaiting_review');

    // 3. Call POST /runs/:id/resume with approve
    const resumeRes = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/resume`,
      headers: authHeaders(resumeBearerToken),
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
        headers: authHeaders(resumeBearerToken),
      });
      status = getRes.json().status;
      retries--;
    }
    expect(status).toBe('approved');
  });

  it('cancels a run via POST /runs/:id/cancel', async () => {
    const cancelBearerToken = `cancel-token-${Date.now()}`;
    const createRes = await app.inject({
      method: 'POST',
      url: '/runs',
      headers: authHeaders(cancelBearerToken),
      payload: { topic: 'Testing Cancellation' },
    });
    const runId = createRes.json().id;

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/runs/${runId}/cancel`,
      headers: authHeaders(cancelBearerToken),
    });

    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe('canceled');

    const getRes = await app.inject({
      method: 'GET',
      url: `/runs/${runId}`,
      headers: authHeaders(cancelBearerToken),
    });
    expect(getRes.json().status).toBe('rejected');
  });
});
