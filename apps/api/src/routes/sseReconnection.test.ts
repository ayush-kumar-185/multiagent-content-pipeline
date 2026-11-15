import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import http from 'node:http';
import crypto from 'node:crypto';
import { buildServer } from '../server.js';
import { createDatabase, DatabaseContext, users, runs } from '../db/index.js';
import { RunEventBus } from '../events/eventBus.js';
import { createRunQueue, RunJobData } from '../queue/index.js';

describe('SSE Stream Disconnect and Reconnection with Last-Event-ID', () => {
  let app: FastifyInstance;
  let dbCtx: DatabaseContext;
  let eventBus: RunEventBus;
  let redis: Redis;
  let queue: Queue<RunJobData>;
  let serverUrl: string;

  const testBearerToken = `sse-token-${Date.now()}`;
  const testUserId = `user_${crypto.createHash('sha256').update(testBearerToken).digest('hex').slice(0, 16)}`;
  const testRunId = `sse-test-run-${Date.now()}`;

  beforeAll(async () => {
    dbCtx = createDatabase();
    eventBus = new RunEventBus(dbCtx);

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

    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    serverUrl = address;

    // Create user and run in DB
    await dbCtx.db.insert(users).values({
      id: testUserId,
      email: `${testUserId}@example.com`,
      name: 'SSE Tester',
    });

    await dbCtx.db.insert(runs).values({
      id: testRunId,
      userId: testUserId,
      topic: 'SSE Stream Reconnect Test',
      config: {
        audience: 'engineers',
        tone: 'technical',
        targetWords: 300,
      },
      status: 'running',
    });
  });

  afterAll(async () => {
    await app.close();
    await queue.close();
    await redis.quit();
    await dbCtx.close();
  });

  interface ParsedSSE {
    id: number;
    event: string;
    data: unknown;
  }

  function parseSSEChunk(chunk: string): ParsedSSE[] {
    const events: ParsedSSE[] = [];
    const blocks = chunk.split('\n\n');
    for (const block of blocks) {
      if (!block.trim() || block.startsWith(':')) continue;
      const lines = block.split('\n');
      let id = 0;
      let event = 'message';
      let dataStr = '';
      for (const line of lines) {
        if (line.startsWith('id: ')) {
          id = parseInt(line.slice(4).trim(), 10);
        } else if (line.startsWith('event: ')) {
          event = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          dataStr = line.slice(6).trim();
        }
      }
      if (id > 0) {
        try {
          events.push({ id, event, data: JSON.parse(dataStr) });
        } catch {
          events.push({ id, event, data: dataStr });
        }
      }
    }
    return events;
  }

  it('client disconnects after event 2, reconnects with Last-Event-ID: 2, and receives remaining events without loss', async () => {
    // 1. Emit 2 events initially
    await eventBus.recordEvent({
      runId: testRunId,
      type: 'run_created',
      data: { msg: 'First event' },
    });
    await eventBus.recordEvent({
      runId: testRunId,
      type: 'node_start',
      node: 'researcher',
      data: { round: 1 },
    });

    // 2. Client 1 connects and reads until receiving sequence 2
    const client1Events: ParsedSSE[] = [];

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `${serverUrl}/runs/${testRunId}/events`,
        {
          headers: {
            authorization: `Bearer ${testBearerToken}`,
            'x-access-code': 'citewriter_demo_2026',
          },
        },
        (res) => {
          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const parsed = parseSSEChunk(buffer);
            for (const p of parsed) {
              if (!client1Events.some((e) => e.id === p.id)) {
                client1Events.push(p);
              }
            }
            if (client1Events.some((e) => e.id === 2)) {
              // Disconnect client 1 once event 2 is received
              req.destroy();
              resolve();
            }
          });
          res.on('error', (err) => {
            // Socket destroyed is expected when we abort
            if ((err as { code?: string }).code === 'ECONNRESET') {
              resolve();
            } else {
              reject(err);
            }
          });
        },
      );
      req.on('error', (err) => {
        if ((err as { code?: string }).code === 'ECONNRESET') {
          resolve();
        } else {
          reject(err);
        }
      });
      req.end();
    });

    expect(client1Events.map((e) => e.id)).toEqual([1, 2]);

    // 3. Emit 3 more events while client 1 is disconnected
    await eventBus.recordEvent({
      runId: testRunId,
      type: 'node_end',
      node: 'researcher',
      data: { notes: 3 },
    });
    await eventBus.recordEvent({
      runId: testRunId,
      type: 'node_start',
      node: 'writer',
      data: { cycle: 1 },
    });
    await eventBus.recordEvent({
      runId: testRunId,
      type: 'node_end',
      node: 'writer',
      data: { draftLength: 200 },
    });

    // 4. Client 2 reconnects using Last-Event-ID: 2
    const client2Events: ParsedSSE[] = [];

    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        `${serverUrl}/runs/${testRunId}/events`,
        {
          headers: {
            authorization: `Bearer ${testBearerToken}`,
            'x-access-code': 'citewriter_demo_2026',
            'last-event-id': '2',
          },
        },
        (res) => {
          let buffer = '';
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString('utf-8');
            const parsed = parseSSEChunk(buffer);
            for (const p of parsed) {
              if (!client2Events.some((e) => e.id === p.id)) {
                client2Events.push(p);
              }
            }
            if (client2Events.some((e) => e.id === 5)) {
              req.destroy();
              resolve();
            }
          });
          res.on('error', (err) => {
            if ((err as { code?: string }).code === 'ECONNRESET') {
              resolve();
            } else {
              reject(err);
            }
          });
        },
      );
      req.on('error', (err) => {
        if ((err as { code?: string }).code === 'ECONNRESET') {
          resolve();
        } else {
          reject(err);
        }
      });
      req.end();
    });

    // 5. Verify Client 2 received precisely events 3, 4, 5 without missing any or getting duplicates
    expect(client2Events.map((e) => e.id)).toEqual([3, 4, 5]);
    expect(client2Events[0]!.event).toBe('node_end');
    expect(client2Events[1]!.event).toBe('node_start');
    expect(client2Events[2]!.event).toBe('node_end');

    // Combined stream is fully continuous: [1, 2, 3, 4, 5]
    const fullStream = [...client1Events, ...client2Events];
    expect(fullStream.map((e) => e.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
