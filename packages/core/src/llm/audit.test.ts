import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import OpenAI from 'openai';
import {
  recordTokenAudit,
  isTokenAuditEnabled,
  TokenAuditRecord,
  extractRateLimitHeaders,
  extractReasoningTokens,
} from './audit.js';
import { generateStructuredOutput } from './structuredOutput.js';

describe('Token Audit Instrumentation (Phase B)', () => {
  const originalEnv = process.env.TOKEN_AUDIT;
  const originalAuditDir = process.env.AUDIT_DIR;
  const testAuditDir = path.resolve(process.cwd(), 'token-audit-test-tmp');
  const testAuditFile = path.join(testAuditDir, 'calls.jsonl');

  beforeEach(() => {
    process.env.AUDIT_DIR = testAuditDir;
    if (fs.existsSync(testAuditDir)) {
      fs.rmSync(testAuditDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    process.env.TOKEN_AUDIT = originalEnv;
    process.env.AUDIT_DIR = originalAuditDir;
    if (fs.existsSync(testAuditDir)) {
      fs.rmSync(testAuditDir, { recursive: true, force: true });
    }
  });

  it('does not record when TOKEN_AUDIT is not set', () => {
    delete process.env.TOKEN_AUDIT;
    expect(isTokenAuditEnabled()).toBe(false);

    const record: TokenAuditRecord = {
      run_id: 'test-run-1',
      agent_name: 'writer',
      node_name: 'writer',
      model_id: 'openai/gpt-oss-20b',
      provider: 'groq',
      input_tokens: 100,
      output_tokens: 50,
      reasoning_tokens: null,
      finish_reason: 'stop',
      latency_ms: 250,
      attempt: 1,
      counted_as_attempt: true,
      is_retry: false,
      is_estimated: false,
      is_truncated: false,
      rate_limit_headers: {},
      timestamp: new Date().toISOString(),
    };

    recordTokenAudit(record);
    expect(fs.existsSync(testAuditFile)).toBe(false);
  });

  it('records formatted jsonl and sanitizes auth keys when TOKEN_AUDIT=1', () => {
    process.env.TOKEN_AUDIT = '1';
    expect(isTokenAuditEnabled()).toBe(true);

    const record: TokenAuditRecord = {
      run_id: 'test-run-2',
      agent_name: 'researcher',
      node_name: 'researcher',
      model_id: 'openai/gpt-oss-20b',
      provider: 'groq',
      input_tokens: 500,
      output_tokens: 120,
      reasoning_tokens: 42,
      finish_reason: 'stop',
      latency_ms: 320,
      attempt: 1,
      counted_as_attempt: true,
      is_retry: false,
      is_estimated: false,
      is_truncated: false,
      rate_limit_headers: {
        'x-ratelimit-remaining-tokens': '5900',
        'authorization': 'Bearer secret-key-here',
        'retry-after': '2',
      },
      error: {
        status: 429,
        body: 'Error with key gsk_1234567890abcdef and token sk-secret999',
      },
      timestamp: new Date().toISOString(),
    };

    recordTokenAudit(record);
    expect(fs.existsSync(testAuditFile)).toBe(true);

    const lines = fs.readFileSync(testAuditFile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(1);

    const firstLine = lines[0] ?? '{}';
    const parsed = JSON.parse(firstLine);
    expect(parsed.run_id).toBe('test-run-2');
    expect(parsed.input_tokens).toBe(500);
    expect(parsed.reasoning_tokens).toBe(42);
    expect(parsed.counted_as_attempt).toBe(true);
    expect(parsed.rate_limit_headers['x-ratelimit-remaining-tokens']).toBe('5900');
    expect(parsed.rate_limit_headers['retry-after']).toBe('2');
    // Authorization header stripped
    expect(parsed.rate_limit_headers['authorization']).toBeUndefined();
    // Key in body sanitized
    expect(String(parsed.error?.body)).toContain('[REDACTED]');
    expect(String(parsed.error?.body)).not.toContain('gsk_1234567890abcdef');
  });

  it('extractRateLimitHeaders correctly filters x-ratelimit and retry-after headers', () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-RateLimit-Limit-Tokens': '8000',
      'X-RateLimit-Remaining-Tokens': '6200',
      'X-RateLimit-Reset-Tokens': '1.2s',
      'Retry-After': '5',
      'Authorization': 'Bearer 12345',
    };

    const extracted = extractRateLimitHeaders(headers);
    expect(extracted).toEqual({
      'x-ratelimit-limit-tokens': '8000',
      'x-ratelimit-remaining-tokens': '6200',
      'x-ratelimit-reset-tokens': '1.2s',
      'retry-after': '5',
    });
    expect(extracted['content-type']).toBeUndefined();
    expect(extracted['authorization']).toBeUndefined();
  });

  it('extractReasoningTokens extracts tokens across multiple provider formats', () => {
    // 1. Standard OpenAI / Groq completion_tokens_details
    expect(
      extractReasoningTokens({
        completion_tokens_details: { reasoning_tokens: 88 },
      }),
    ).toBe(88);

    // 2. Direct reasoning_tokens field
    expect(
      extractReasoningTokens({
        reasoning_tokens: 45,
      }),
    ).toBe(45);

    // 3. thinking_tokens field
    expect(
      extractReasoningTokens({
        completion_tokens_details: { thinking_tokens: 30 },
      }),
    ).toBe(30);

    // 4. Missing or null
    expect(extractReasoningTokens({})).toBeNull();
    expect(extractReasoningTokens(null)).toBeNull();
  });

  it('produces correct JSONL rows for mocked success, 400-truncation, and 429 responses', async () => {
    process.env.TOKEN_AUDIT = '1';
    const schema = z.object({ answer: z.string() });

    // ----------------------------------------------------
    // Scenario 1: Mocked Success Response
    // ----------------------------------------------------
    const successClient = {
      chat: {
        completions: {
          create: vi.fn().mockReturnValue({
            withResponse: async () => ({
              data: {
                choices: [
                  {
                    message: { content: JSON.stringify({ answer: 'verified claim' }) },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 150,
                  completion_tokens: 75,
                  completion_tokens_details: { reasoning_tokens: 28 },
                },
              },
              response: {
                headers: {
                  'x-ratelimit-limit-tokens': '8000',
                  'x-ratelimit-remaining-tokens': '7500',
                  'retry-after': '0',
                },
              },
            }),
          }),
        },
      },
    } as unknown as OpenAI;

    const successResult = await generateStructuredOutput({
      client: successClient,
      model: 'openai/gpt-oss-120b',
      schema,
      systemPrompt: 'System',
      userPrompt: 'User',
      runId: 'run-success',
      agentRole: 'factChecker',
      maxTokens: 1500,
    });

    expect(successResult.data.answer).toBe('verified claim');

    // ----------------------------------------------------
    // Scenario 2: Mocked 400 Truncation Response
    // ----------------------------------------------------
    const truncationErr = new Error(
      'max completion tokens reached before generating a valid document',
    );
    (truncationErr as unknown as { status: number }).status = 400;
    (truncationErr as unknown as { error: unknown }).error = {
      message: 'max completion tokens reached before generating a valid document',
      code: 'json_validate_failed',
    };
    (truncationErr as unknown as { headers: Record<string, string> }).headers = {
      'x-ratelimit-remaining-tokens': '4200',
      'x-ratelimit-limit-tokens': '8000',
    };

    const truncatingClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const p = Promise.reject(truncationErr);
            (p as unknown as { withResponse: () => Promise<unknown> }).withResponse = () => p;
            return p;
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: truncatingClient,
        model: 'openai/gpt-oss-120b',
        schema,
        systemPrompt: 'System prompt content for testing length',
        userPrompt: 'User prompt content to estimate tokens',
        runId: 'run-truncation',
        agentRole: 'factChecker',
        maxTokens: 1500,
      }),
    ).rejects.toThrow();

    // ----------------------------------------------------
    // Scenario 3: Mocked 429 Rate Limit Response
    // ----------------------------------------------------
    const rateLimitErr = new Error(
      'Rate limit reached for model qwen/qwen3.8-27b on tokens per minute',
    );
    (rateLimitErr as unknown as { status: number }).status = 429;
    (rateLimitErr as unknown as { error: unknown }).error = {
      message: 'Rate limit reached for model qwen/qwen3.8-27b on tokens per minute',
      type: 'tokens',
      code: 'rate_limit_exceeded',
    };
    (rateLimitErr as unknown as { headers: Record<string, string> }).headers = {
      'x-ratelimit-remaining-tokens': '0',
      'retry-after': '15',
    };

    const rateLimitClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const p = Promise.reject(rateLimitErr);
            (p as unknown as { withResponse: () => Promise<unknown> }).withResponse = () => p;
            return p;
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: rateLimitClient,
        model: 'qwen/qwen3.8-27b',
        schema,
        systemPrompt: 'Writer system instructions',
        userPrompt: 'Draft article content',
        runId: 'run-429',
        agentRole: 'writer',
        maxTokens: 2500,
      }),
    ).rejects.toThrow(/Rate limit or quota exceeded/);

    // ----------------------------------------------------
    // Verify JSONL File Rows
    // ----------------------------------------------------
    expect(fs.existsSync(testAuditFile)).toBe(true);
    const lines = fs
      .readFileSync(testAuditFile, 'utf-8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));

    expect(lines.length).toBe(4);

    // Row 1: Success row
    const row1 = lines[0];
    expect(row1.run_id).toBe('run-success');
    expect(row1.input_tokens).toBe(150);
    expect(row1.output_tokens).toBe(75);
    expect(row1.reasoning_tokens).toBe(28);
    expect(row1.finish_reason).toBe('stop');
    expect(row1.counted_as_attempt).toBe(true);
    expect(row1.is_truncated).toBe(false);
    expect(row1.is_estimated).toBe(false);
    expect(row1.rate_limit_headers['x-ratelimit-remaining-tokens']).toBe('7500');
    expect(row1.rate_limit_headers['retry-after']).toBe('0');
    expect(row1.error).toBeUndefined();

    // Row 2: 400-truncation initial attempt
    const row2 = lines[1];
    expect(row2.run_id).toBe('run-truncation');
    expect(row2.error?.status).toBe(400);
    expect(String(row2.error?.body?.message)).toContain('max completion tokens reached');
    expect(row2.is_truncated).toBe(true);
    expect(row2.finish_reason).toBe('length');
    expect(row2.counted_as_attempt).toBe(true);
    expect(row2.attempt).toBe(1);
    expect(row2.is_retry).toBe(false);
    // Never record failures as silent zeros!
    expect(row2.input_tokens).toBeGreaterThan(0);
    expect(row2.output_tokens).toBe(1500); // requested max_tokens
    expect(row2.is_estimated).toBe(true);
    expect(row2.rate_limit_headers['x-ratelimit-remaining-tokens']).toBe('4200');

    // Row 3: 400-truncation retry attempt
    const row3 = lines[2];
    expect(row3.run_id).toBe('run-truncation');
    expect(row3.error?.status).toBe(400);
    expect(row3.is_truncated).toBe(true);
    expect(row3.attempt).toBe(2);
    expect(row3.is_retry).toBe(true);
    expect(row3.output_tokens).toBe(2250); // elevated max_tokens (1500 * 1.5)

    // Row 4: 429 rate-limit row
    const row4 = lines[3];
    expect(row4.run_id).toBe('run-429');
    expect(row4.error?.status).toBe(429);
    expect(row4.error?.body?.type).toBe('tokens');
    expect(row4.counted_as_attempt).toBe(true);
    expect(row4.input_tokens).toBeGreaterThan(0);
    expect(row4.is_truncated).toBe(false);
    expect(row4.rate_limit_headers['x-ratelimit-remaining-tokens']).toBe('0');
    expect(row4.rate_limit_headers['retry-after']).toBe('15');
  });
});
