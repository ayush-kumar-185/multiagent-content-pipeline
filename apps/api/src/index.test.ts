import { describe, it, expect, afterAll } from 'vitest';
import { buildServer } from './index.js';

describe('Fastify API scaffold test', () => {
  const app = buildServer();

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 and healthy status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('citewriter-api');
    expect(body.coreVersion).toBe('0.1.0');
  });
});
