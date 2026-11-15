import { describe, it, expect, afterAll, vi } from 'vitest';
import { buildServer } from './index.js';

describe('Fastify API scaffold test', () => {
  const mockDbCtx = {
    db: {} as any,
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
      end: vi.fn().mockResolvedValue(undefined),
    } as any,
    close: async () => {},
  };

  const mockRedis = {
    ping: vi.fn().mockResolvedValue('PONG'),
    quit: vi.fn().mockResolvedValue('OK'),
  } as any;

  const mockQueue = {
    close: vi.fn().mockResolvedValue(undefined),
  } as any;

  const app = buildServer({
    dbCtx: mockDbCtx,
    redis: mockRedis,
    queue: mockQueue,
    accessCode: 'citewriter_demo_2026',
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200, healthy status, and execution mode', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('citewriter-api');
    expect(body.coreVersion).toBe('0.1.0');
    expect(body.mode).toBeDefined();
    expect(['real', 'mock']).toContain(body.mode);
  });

  it('GET /health/ready checks PostgreSQL and Redis connectivity', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('citewriter-api');
    expect(body.checks.database).toBe('ok');
    expect(body.checks.redis).toBe('ok');
  });
});
