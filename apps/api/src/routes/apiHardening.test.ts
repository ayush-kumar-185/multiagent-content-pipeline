import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { buildServer } from '../server.js';
import { createDatabase, DatabaseContext, users } from '../db/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { createRunQueue, RunJobData } from '../queue/index.js';

describe('Phase 9 API Hardening: Request Size Limits, Validation, and Structured Errors', () => {
  let app: FastifyInstance;
  let dbCtx: DatabaseContext;
  let redis: Redis;
  let queue: Queue<RunJobData>;
  const testUserId = `hardening-user-${Date.now()}`;

  beforeAll(async () => {
    dbCtx = createDatabase();
    const eventBus = new RunEventBus(dbCtx);

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = createRunQueue(redis);

    app = buildServer({
      dbCtx,
      eventBus,
      queue,
      redis,
      accessCode: 'citewriter_demo_2026',
    });
    await app.ready();

    // Insert mock user
    await dbCtx.db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@security.local`,
      name: 'Security Auditor',
    });
  });

  afterAll(async () => {
    await app.close();
    await queue.close();
    await redis.quit();
    await dbCtx.close();
  });

  describe('Request Body Size Enforcement (1 MB Limit)', () => {
    it('rejects oversized HTTP payloads (>1 MB) with 413 and structured error', async () => {
      // 1.2 MB oversized string
      const oversizedPayload = {
        topic: 'A'.repeat(1_200_000),
      };

      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: {
          'x-access-code': 'citewriter_demo_2026',
          'content-type': 'application/json',
        },
        payload: oversizedPayload,
      });

      expect(res.statusCode).toBe(413);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('Input Validation & Boundary Checking', () => {
    it('rejects topics shorter than 3 characters with 400 and VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'citewriter_demo_2026' },
        payload: { topic: 'ab' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.validationErrors).toBeDefined();
    });

    it('rejects topics exceeding 1000 characters with 400 and VALIDATION_ERROR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'citewriter_demo_2026' },
        payload: { topic: 'X'.repeat(1005) },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects non-HTTP/HTTPS source URLs', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'citewriter_demo_2026' },
        payload: {
          topic: 'Secure Enclaves',
          sourceUrl: 'ftp://ftp.example.com/exploit',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects negative targetWords and negative budget caps', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'citewriter_demo_2026' },
        payload: {
          topic: 'Secure Enclaves',
          config: {
            targetWords: -100,
            maxTokens: -500,
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid actions in /runs/:id/resume', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/runs/run_dummy_123/resume',
        headers: { 'x-access-code': 'citewriter_demo_2026' },
        payload: {
          action: 'invalid_action',
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Structured Global 404 Handler', () => {
    it('returns structured JSON with 404 when requesting an unmapped route', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/non-existent-endpoint',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe('NOT_FOUND');
      expect(body.error.statusCode).toBe(404);
    });
  });
});
