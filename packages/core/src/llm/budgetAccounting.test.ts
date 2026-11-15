import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import OpenAI from 'openai';
import { generateStructuredOutput } from './structuredOutput.js';
import { BudgetExceededError } from './budget.js';

describe('Budget Accounting: Failed Calls and Reasoning Tokens (Part 1 Audit)', () => {
  const TestSchema = z.object({
    result: z.string(),
  });

  it('counts tokens from failed/truncated calls towards MAX_RUN_TOKENS on retries', async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // Attempt 1 fails with a 400 truncation error and consumes 300 prompt tokens + 700 completion tokens
              const err = new Error('400 max completion tokens reached');
              (err as unknown as { status: number }).status = 400;
              (err as unknown as { error: unknown }).error = {
                message: 'max completion tokens reached',
                code: 'json_validate_failed',
              };
              (err as unknown as { usage: unknown }).usage = {
                prompt_tokens: 300,
                completion_tokens: 700,
                total_tokens: 1000,
              };
              return Promise.reject(err);
            }
            return Promise.resolve({
              usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
              choices: [
                {
                  message: { content: JSON.stringify({ result: 'success' }) },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    // Budget limit is 1200 tokens. Current tokens used is 500.
    // Attempt 1 uses 1000 tokens (300 prompt + 700 completion). Total accumulated becomes 500 + 1000 = 1500 > 1200.
    // Attempt 2 must be halted by assertWithinBudget before making another LLM call!
    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'openai/gpt-oss-120b',
        systemPrompt: 'System',
        userPrompt: 'User',
        schema: TestSchema,
        budgetLimits: {
          maxRunTokens: 1200,
          maxRunCostUsd: 1.0,
        },
        currentTokensUsed: 500,
      }),
    ).rejects.toThrow(BudgetExceededError);

    // Call count must be exactly 1: attempt 2 was prevented by the budget guard
    expect(callCount).toBe(1);

    // Verify error properties
    try {
      await generateStructuredOutput({
        client: mockClient,
        model: 'openai/gpt-oss-120b',
        systemPrompt: 'System',
        userPrompt: 'User',
        schema: TestSchema,
        budgetLimits: {
          maxRunTokens: 1200,
          maxRunCostUsd: 1.0,
        },
        currentTokensUsed: 500,
      });
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const budgetErr = err as BudgetExceededError;
      // 500 starting + 1000 from failed attempt = 1500 tokens used
      expect(budgetErr.tokensUsed).toBe(1500);
      expect(budgetErr.limitType).toBe('tokens');
      expect(budgetErr.message).toContain('Token budget exceeded: used 1500 tokens (limit is 1200)');
    }
  });

  it('counts reasoning tokens towards MAX_RUN_TOKENS when provided via completion_tokens_details or total_tokens', async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              // Attempt 1: Content is invalid JSON, triggering a validation retry
              // Returns 200 prompt tokens, 100 completion tokens, and 600 reasoning tokens (total 900 tokens)
              return Promise.resolve({
                usage: {
                  prompt_tokens: 200,
                  completion_tokens: 700, // 100 content + 600 reasoning
                  completion_tokens_details: {
                    reasoning_tokens: 600,
                  },
                  total_tokens: 900,
                },
                choices: [
                  {
                    message: { content: 'not valid json' },
                    finish_reason: 'stop',
                  },
                ],
              });
            }
            return Promise.resolve({
              usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
              choices: [
                {
                  message: { content: JSON.stringify({ result: 'valid' }) },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    // Budget limit is 1000 tokens. Current tokens used is 200.
    // Attempt 1 consumes 200 prompt + 700 completion (with 600 reasoning) = 900 tokens.
    // Total tokens becomes 200 + 900 = 1100 > 1000.
    // Before attempt 2, assertWithinBudget throws BudgetExceededError with 1100 tokens used.
    try {
      await generateStructuredOutput({
        client: mockClient,
        model: 'openai/gpt-oss-120b',
        systemPrompt: 'System',
        userPrompt: 'User',
        schema: TestSchema,
        budgetLimits: {
          maxRunTokens: 1000,
          maxRunCostUsd: 1.0,
        },
        currentTokensUsed: 200,
      });
      expect.fail('Should have thrown BudgetExceededError');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(BudgetExceededError);
      const budgetErr = err as BudgetExceededError;
      expect(budgetErr.tokensUsed).toBe(1100);
      expect(budgetErr.limitType).toBe('tokens');
      expect(budgetErr.message).toContain('Token budget exceeded: used 1100 tokens (limit is 1000)');
    }

    // Attempt 2 was blocked
    expect(callCount).toBe(1);
  });
});

