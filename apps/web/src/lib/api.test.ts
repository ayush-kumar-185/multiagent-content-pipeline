import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRun, listRuns, getRun, resumeRun, cancelRun, getEventsStreamUrl } from './api';

describe('Web API Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds SSE url with and without lastEventId', () => {
    const url1 = getEventsStreamUrl('run_123');
    expect(url1).toContain('/runs/run_123/events');
    expect(url1).not.toContain('lastEventId');

    const url2 = getEventsStreamUrl('run_123', 5);
    expect(url2).toContain('/runs/run_123/events');
    expect(url2).toContain('lastEventId=5');
  });

  it('creates run via POST /runs with auth headers', async () => {
    const mockRun = { id: 'run_abc', topic: 'Testing API', status: 'pending' };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    });
    global.fetch = mockFetch;

    const result = await createRun(
      { topic: 'Testing API', config: { targetWords: 300 } },
      'user_123',
    );

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/runs'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Access-Code': 'citewriter_demo_2026',
        }),
      }),
    );
    expect(result.id).toBe('run_abc');
  });

  it('lists runs for user', async () => {
    const mockRuns = [{ id: 'run_1' }, { id: 'run_2' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ runs: mockRuns }),
    });

    const result = await listRuns('user_123');
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe('run_1');
  });

  it('fetches run by id', async () => {
    const mockRun = { id: 'run_1', topic: 'Specific Run' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRun,
    });

    const result = await getRun('run_1', 'user_123');
    expect(result.id).toBe('run_1');
  });

  it('resumes run with review payload', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'resuming', runId: 'run_1', decision: 'approve' }),
    });

    const result = await resumeRun('run_1', { action: 'approve' }, 'user_123');
    expect(result.status).toBe('resuming');
  });

  it('cancels run', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'canceled', runId: 'run_1' }),
    });

    const result = await cancelRun('run_1', 'user_123');
    expect(result.status).toBe('canceled');
  });
});
