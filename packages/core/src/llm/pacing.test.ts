import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseResetDurationMs,
  updatePacingState,
  getPacingWaitMs,
  waitForPacing,
  resetPacingState,
  MAX_SINGLE_WAIT_MS,
} from './pacing.js';
import {
  recordDailyTokens,
  getModelDailyLimit,
  loadDailyLedger,
  resetDailyLedgerWarnings,
} from './ledger.js';

describe('Phase D: Token-Aware Pacing', () => {
  beforeEach(() => {
    resetPacingState();
  });

  describe('parseResetDurationMs', () => {
    it('parses various duration string formats correctly', () => {
      expect(parseResetDurationMs('6s')).toBe(6000);
      expect(parseResetDurationMs('1.5s')).toBe(1500);
      expect(parseResetDurationMs('600ms')).toBe(600);
      expect(parseResetDurationMs('1m15s')).toBe(75000);
      expect(parseResetDurationMs('2m')).toBe(120000);
      expect(parseResetDurationMs('5')).toBe(5000);
      expect(parseResetDurationMs('')).toBe(0);
      expect(parseResetDurationMs(undefined)).toBe(0);
    });
  });

  describe('updatePacingState and getPacingWaitMs', () => {
    it('requires 0 wait when remaining tokens exceed estimated needed tokens', () => {
      updatePacingState('openai/gpt-oss-20b', {
        'x-ratelimit-remaining-tokens': '6500',
        'x-ratelimit-reset-tokens': '5s',
      });

      // Needed 2500 tokens, remaining is 6500 -> no wait
      const wait = getPacingWaitMs('openai/gpt-oss-20b', 2500);
      expect(wait).toBe(0);
    });

    it('requires wait until reset time when needed tokens exceed remaining tokens', () => {
      const now = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      updatePacingState('openai/gpt-oss-20b', {
        'x-ratelimit-remaining-tokens': '1000',
        'x-ratelimit-reset-tokens': '8s',
      });

      // Needed 2500 tokens, remaining is only 1000 -> wait 8000ms
      const wait = getPacingWaitMs('openai/gpt-oss-20b', 2500, now);
      expect(wait).toBe(8000);

      vi.restoreAllMocks();
    });

    it('caps any single wait at 70 seconds', () => {
      const now = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      updatePacingState('qwen/qwen3.8-27b', {
        'x-ratelimit-remaining-tokens': '500',
        'x-ratelimit-reset-tokens': '95s', // 95 seconds
      });

      // Wait must be capped at 70s
      const wait = getPacingWaitMs('qwen/qwen3.8-27b', 3000, now);
      expect(wait).toBe(MAX_SINGLE_WAIT_MS);
      expect(wait).toBe(70_000);

      vi.restoreAllMocks();
    });

    it('returns 0 wait when time has passed reset time', () => {
      const baseTime = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(baseTime);

      updatePacingState('openai/gpt-oss-120b', {
        'x-ratelimit-remaining-tokens': '100',
        'x-ratelimit-reset-tokens': '2s',
      });

      // 3 seconds later, window has reset
      const later = baseTime + 3000;
      const wait = getPacingWaitMs('openai/gpt-oss-120b', 2000, later);
      expect(wait).toBe(0);

      vi.restoreAllMocks();
    });
  });

  describe('waitForPacing', () => {
    it('calls sleep function when wait is required', async () => {
      const now = 1_000_000;
      vi.spyOn(Date, 'now').mockReturnValue(now);

      updatePacingState('openai/gpt-oss-20b', {
        'x-ratelimit-remaining-tokens': '500',
        'x-ratelimit-reset-tokens': '3.5s',
      });

      const sleepMock = vi.fn().mockResolvedValue(undefined);
      const waited = await waitForPacing('openai/gpt-oss-20b', 2000, sleepMock);

      expect(waited).toBe(3500);
      expect(sleepMock).toHaveBeenCalledWith(3500);

      vi.restoreAllMocks();
    });

    it('does not sleep when tokens are sufficient', async () => {
      updatePacingState('openai/gpt-oss-20b', {
        'x-ratelimit-remaining-tokens': '7500',
        'x-ratelimit-reset-tokens': '5s',
      });

      const sleepMock = vi.fn();
      const waited = await waitForPacing('openai/gpt-oss-20b', 2000, sleepMock);

      expect(waited).toBe(0);
      expect(sleepMock).not.toHaveBeenCalled();
    });
  });
});

describe('Phase D: Daily Token Ledger', () => {
  const originalAuditDir = process.env.AUDIT_DIR;
  const testDir = path.resolve(process.cwd(), 'token-audit-ledger-test-tmp');
  const testFile = path.join(testDir, 'ledger.json');

  beforeEach(() => {
    process.env.AUDIT_DIR = testDir;
    resetDailyLedgerWarnings();
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    process.env.AUDIT_DIR = originalAuditDir;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.DAILY_TOKEN_LIMIT_TEST_MODEL;
  });

  it('records prompt and completion tokens per model and UTC date', () => {
    const today = '2026-11-14';

    recordDailyTokens('openai/gpt-oss-20b', 1200, 300, false, today);
    recordDailyTokens('openai/gpt-oss-20b', 800, 200, false, today);
    recordDailyTokens('openai/gpt-oss-20b', 500, 0, true, today); // failed call

    expect(fs.existsSync(testFile)).toBe(true);
    const data = loadDailyLedger();
    const modelStats = data[today]?.['openai/gpt-oss-20b'];

    expect(modelStats).toBeDefined();
    expect(modelStats?.promptTokens).toBe(2500);
    expect(modelStats?.completionTokens).toBe(500);
    expect(modelStats?.totalTokens).toBe(3000);
    expect(modelStats?.calls).toBe(3);
    expect(modelStats?.failedCalls).toBe(1);
  });

  it('reads configured daily limits from environment variables', () => {
    process.env.DAILY_TOKEN_LIMIT_TEST_MODEL = '150000';
    expect(getModelDailyLimit('test-model')).toBe(150000);
  });

  it('warns when total tokens reach 80% of configured daily limit', () => {
    process.env.DAILY_TOKEN_LIMIT_TEST_MODEL = '10000'; // 80% is 8000
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const today = '2026-11-14';

    // Call 1: 5000 tokens (50%) -> no warning
    recordDailyTokens('test-model', 4000, 1000, false, today);
    expect(warnSpy).not.toHaveBeenCalled();

    // Call 2: 3500 tokens (Total 8500 = 85%) -> triggers 80% warning
    recordDailyTokens('test-model', 2500, 1000, false, today);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceeding 80% of its daily limit'),
    );

    warnSpy.mockRestore();
  });
});

