import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { timingSafeEqualString, createAuthMiddleware } from '../auth/index.js';
import { registerRunRoutes } from './runs.js';
import { validateStartupEnvironment, MissingApiKeyError } from '../config/mode.js';
import { recordDailyTokens, resetDailyLedgerWarnings } from '@citewriter/core';

describe('Task 1 & Task 3: Public Demo Protection, Caps, and Explicit Mode', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ACCESS_CODE = 'test_access_code_123';
    process.env.USE_REAL_LLM = 'false';
    resetDailyLedgerWarnings();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Access Code Constant-Time Comparison', () => {
    it('timingSafeEqualString correctly compares equal strings and rejects mismatches', () => {
      expect(timingSafeEqualString('secret-code-2026', 'secret-code-2026')).toBe(true);
      expect(timingSafeEqualString('secret-code-2026', 'secret-code-2027')).toBe(false);
      expect(timingSafeEqualString('short', 'much-longer-secret-code')).toBe(false);
      expect(timingSafeEqualString('', 'non-empty')).toBe(false);
      expect(timingSafeEqualString('', '')).toBe(true);
    });
  });

  describe('2. Fastify Route Protection: 401 on Missing/Invalid Access Code & Identity Isolation', () => {
    function buildProtectedApp(mockDb: any) {
      const app = Fastify({ logger: false });
      const authMiddleware = createAuthMiddleware({
        db: mockDb,
        pool: {} as any,
        close: async () => {},
      });

      app.addHook('preHandler', async (req, reply) => {
        if (req.url.startsWith('/runs')) {
          await authMiddleware(req, reply);
        }
      });

      app.get('/runs', async (req) => {
        return { user: req.user };
      });

      return app;
    }

    it('returns 401 when X-Access-Code header is completely missing', async () => {
      const mockDb = { select: vi.fn(), insert: vi.fn() };
      const app = buildProtectedApp(mockDb);

      const res = await app.inject({
        method: 'GET',
        url: '/runs',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toMatch(/Missing required X-Access-Code/i);
      // DB must never be queried if access code is missing
      expect(mockDb.select).not.toHaveBeenCalled();
      expect(mockDb.insert).not.toHaveBeenCalled();
    });

    it('returns 401 when X-Access-Code header is incorrect', async () => {
      const mockDb = { select: vi.fn(), insert: vi.fn() };
      const app = buildProtectedApp(mockDb);

      const res = await app.inject({
        method: 'GET',
        url: '/runs',
        headers: {
          'x-access-code': 'wrong_code_xyz',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBe('Unauthorized');
      expect(body.message).toMatch(/Invalid access code/i);
      expect(mockDb.select).not.toHaveBeenCalled();
    });

    it('creates/provisions user only AFTER the access code passes, ignoring client-supplied x-user-id', async () => {
      let createdUser: any = null;
      const mockDb = {
        select: () => ({
          from: () => ({
            where: vi.fn().mockResolvedValue([]), // No existing user
          }),
        }),
        insert: () => ({
          values: (val: any) => {
            createdUser = val;
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([val]),
              }),
            };
          },
        }),
      };

      const app = buildProtectedApp(mockDb);

      const res = await app.inject({
        method: 'GET',
        url: '/runs',
        headers: {
          'x-access-code': 'test_access_code_123',
          'x-user-id': 'untrusted_spoofed_admin_id', // Must be ignored!
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user).toBeDefined();
      expect(body.user.id).not.toBe('untrusted_spoofed_admin_id');
      expect(body.user.id).toMatch(/^demo_user_/);
      expect(createdUser).toBeDefined();
      expect(createdUser.id).toBe(body.user.id);
    });
  });

  describe('3. Global Caps, Concurrency, and Per-IP Daily Limit Enforcement', () => {
    function setupRunWithMockCount(options: {
      activeCount?: number;
      dailyCount?: number;
      ipDailyCount?: number;
    }) {
      const insertedRuns: any[] = [];
      const queueAdd = vi.fn().mockResolvedValue({});
      const recordEvent = vi.fn().mockResolvedValue({});

      const mockDb = {
        select: () => ({
          from: (_table: any) => ({
            where: (_cond: any) => {
              // Return simulated counts
              if (options.activeCount !== undefined) {
                return Promise.resolve([{ count: options.activeCount }]);
              }
              if (options.dailyCount !== undefined) {
                return Promise.resolve([{ count: options.dailyCount }]);
              }
              if (options.ipDailyCount !== undefined) {
                return Promise.resolve([{ count: options.ipDailyCount }]);
              }
              return Promise.resolve([{ count: 0 }]);
            },
          }),
        }),
        insert: () => ({
          values: (val: any) => {
            insertedRuns.push(val);
            return {
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([val]),
              }),
              returning: () => Promise.resolve([val]),
            };
          },
        }),
      };

      const app = Fastify({ logger: false });
      const authMiddleware = createAuthMiddleware({
        db: mockDb as any,
        pool: {} as any,
        close: async () => {},
      });

      app.addHook('preHandler', async (req, reply) => {
        if (req.url.startsWith('/runs')) {
          await authMiddleware(req, reply);
        }
      });

      registerRunRoutes(app, {
        dbCtx: { db: mockDb as any, pool: {} as any, close: async () => {} },
        eventBus: { recordEvent } as any,
        queue: { add: queueAdd } as any,
      });

      return { app, insertedRuns, queueAdd };
    }

    it('returns 429 when MAX_CONCURRENT_RUNS cap is exceeded with retry hint', async () => {
      process.env.MAX_CONCURRENT_RUNS = '1';
      const { app } = setupRunWithMockCount({ activeCount: 1 });

      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'test_access_code_123' },
        payload: { topic: 'Testing Concurrency Cap' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.error).toBe('Too Many Requests');
      expect(body.code).toBe('GLOBAL_CONCURRENCY_EXCEEDED');
      expect(body.message).toMatch(/concurrent run limit reached/i);
      expect(body.retryHint).toBeDefined();
    });

    it('returns 429 when MAX_RUNS_PER_DAY cap is exceeded with retry hint', async () => {
      process.env.MAX_CONCURRENT_RUNS = '10';
      process.env.MAX_RUNS_PER_DAY = '5';
      const { app } = setupRunWithMockCount({ dailyCount: 5 });

      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'test_access_code_123' },
        payload: { topic: 'Testing Daily Run Cap' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.error).toBe('Too Many Requests');
      expect(body.code).toBe('GLOBAL_DAILY_CAP_EXCEEDED');
      expect(body.message).toMatch(/daily run limit reached/i);
      expect(body.retryHint).toMatch(/00:00 UTC/i);
    });

    it('returns 429 when MAX_RUNS_PER_IP_PER_DAY cap is exceeded with retry hint', async () => {
      process.env.MAX_CONCURRENT_RUNS = '10';
      process.env.MAX_RUNS_PER_DAY = '100';
      process.env.MAX_RUNS_PER_IP_PER_DAY = '2';
      const { app } = setupRunWithMockCount({ ipDailyCount: 2 });

      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'test_access_code_123' },
        payload: { topic: 'Testing IP Daily Cap' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.error).toBe('Too Many Requests');
      expect(body.code).toBe('IP_DAILY_CAP_EXCEEDED');
      expect(body.message).toMatch(/Daily run limit for IP/i);
      expect(body.retryHint).toMatch(/00:00 UTC/i);
    });
  });

  describe('4. Token Ledger Headroom Check in Real Mode', () => {
    it('returns 429 "quota exhausted, try later" in real mode when remaining tokens are below headroom', async () => {
      process.env.USE_REAL_LLM = 'true';
      process.env.LEDGER_HEADROOM_TOKENS = '25000';
      process.env.RESEARCHER_MODEL = 'openai/gpt-oss-20b';
      process.env.DAILY_TOKEN_LIMIT_OPENAI_GPT_OSS_20B = '200000';

      // Simulate ledger usage: 180,000 used out of 200,000 (remaining: 20,000 < 25,000 headroom)
      recordDailyTokens('openai/gpt-oss-20b', 100000, 80000);

      const mockDb = {
        select: () => ({
          from: () => ({
            where: vi.fn().mockResolvedValue([{ count: 0 }]),
          }),
        }),
        insert: () => ({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'run_test' }]),
          }),
        }),
      };

      const app = Fastify({ logger: false });
      const authMiddleware = createAuthMiddleware({
        db: mockDb as any,
        pool: {} as any,
        close: async () => {},
      });

      app.addHook('preHandler', async (req, reply) => {
        if (req.url.startsWith('/runs')) {
          await authMiddleware(req, reply);
        }
      });

      registerRunRoutes(app, {
        dbCtx: { db: mockDb as any, pool: {} as any, close: async () => {} },
        eventBus: { recordEvent: vi.fn() } as any,
        queue: { add: vi.fn() } as any,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/runs',
        headers: { 'x-access-code': 'test_access_code_123' },
        payload: { topic: 'Testing Ledger Headroom Rejection' },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.error).toBe('Too Many Requests');
      expect(body.code).toBe('QUOTA_EXHAUSTED');
      expect(body.message).toBe('quota exhausted, try later');
      expect(body.retryHint).toMatch(/headroom/i);
    });
  });

  describe('5. Explicit Real vs Mock Mode & Startup Validation', () => {
    it('validateStartupEnvironment succeeds with mode: mock when USE_REAL_LLM=false', () => {
      process.env.USE_REAL_LLM = 'false';
      delete process.env.GEMINI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.TAVILY_API_KEY;

      const res = validateStartupEnvironment();
      expect(res.mode).toBe('mock');
    });

    it('validateStartupEnvironment fails fast listing missing keys when USE_REAL_LLM=true without keys', () => {
      process.env.USE_REAL_LLM = 'true';
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_AI_STUDIO_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.TAVILY_API_KEY;
      process.env.SEARCH_PROVIDER = 'tavily';
      process.env.RESEARCHER_PROVIDER = 'groq';

      expect(() => validateStartupEnvironment()).toThrow(MissingApiKeyError);

      try {
        validateStartupEnvironment();
      } catch (err: any) {
        expect(err.missingKeys).toContain('TAVILY_API_KEY');
        expect(err.missingKeys).toContain('GROQ_API_KEY');
        // Ensure values are never printed
        expect(err.message).not.toContain('secret');
      }
    });

    it('validateStartupEnvironment succeeds when USE_REAL_LLM=true and required keys are present', () => {
      process.env.USE_REAL_LLM = 'true';
      process.env.RESEARCHER_PROVIDER = 'groq';
      process.env.WRITER_PROVIDER = 'groq';
      process.env.FACT_CHECKER_PROVIDER = 'groq';
      process.env.EDITOR_PROVIDER = 'groq';
      process.env.GROQ_API_KEY = 'gsk_mock_valid_key';
      process.env.SEARCH_PROVIDER = 'tavily';
      process.env.TAVILY_API_KEY = 'tvly_mock_valid_key';

      const res = validateStartupEnvironment();
      expect(res.mode).toBe('real');
    });

    it('GET /health returns mode field (mock or real)', async () => {
      process.env.USE_REAL_LLM = 'false';
      const app = Fastify({ logger: false });
      app.get('/health', async () => ({
        status: 'ok',
        service: 'citewriter-api',
        mode: process.env.USE_REAL_LLM === 'true' ? 'real' : 'mock',
      }));

      const res1 = await app.inject({ method: 'GET', url: '/health' });
      expect(res1.json().mode).toBe('mock');

      process.env.USE_REAL_LLM = 'true';
      const res2 = await app.inject({ method: 'GET', url: '/health' });
      expect(res2.json().mode).toBe('real');
    });
  });
});
