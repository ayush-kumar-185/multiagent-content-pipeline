import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import OpenAI from 'openai';
import { checkBudget, assertWithinBudget, BudgetExceededError } from './budget.js';
import { estimateCostUsd } from './cost.js';
import { generateStructuredOutput } from './structuredOutput.js';

describe('LLM Layer: Budget Guard and Cost Accounting', () => {
  it('allows execution when usage is within limits', () => {
    const limits = { maxRunTokens: 50_000, maxRunCostUsd: 1.0 };
    const check = checkBudget(10_000, 0.25, limits);
    expect(check.exceeded).toBe(false);
    expect(() => assertWithinBudget(10_000, 0.25, limits)).not.toThrow();
  });

  it('detects and throws BudgetExceededError when token limit is breached', () => {
    const limits = { maxRunTokens: 50_000, maxRunCostUsd: 1.0 };
    const check = checkBudget(50_000, 0.25, limits);
    expect(check.exceeded).toBe(true);
    expect(check.limitType).toBe('tokens');
    expect(() => assertWithinBudget(50_000, 0.25, limits)).toThrow(BudgetExceededError);
  });

  it('detects and throws BudgetExceededError when cost limit is breached', () => {
    const limits = { maxRunTokens: 100_000, maxRunCostUsd: 0.5 };
    const check = checkBudget(20_000, 0.55, limits);
    expect(check.exceeded).toBe(true);
    expect(check.limitType).toBe('cost');
    expect(() => assertWithinBudget(20_000, 0.55, limits)).toThrow(BudgetExceededError);
  });

  it('calculates cost according to model pricing table', () => {
    // gpt-4o: $2.5 / 1M prompt, $10.0 / 1M completion
    const cost = estimateCostUsd('gpt-4o', 1000, 500);
    // (1000 / 1M * 2.5) + (500 / 1M * 10) = 0.0025 + 0.0050 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 4);

    // gpt-4o-mini: $0.15 / 1M prompt, $0.60 / 1M completion
    const miniCost = estimateCostUsd('gpt-4o-mini', 1000, 1000);
    // (0.00015) + (0.0006) = 0.00075
    expect(miniCost).toBeCloseTo(0.00075, 5);
  });
});

describe('LLM Layer: Structured Output with Zod Validation and Retries', () => {
  const TestSchema = z.object({
    summary: z.string().min(5),
    tags: z.array(z.string()).min(1),
  });

  it('successfully parses valid JSON on first attempt', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 100, completion_tokens: 50 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'Valid summary text',
                    tags: ['tech', 'typescript'],
                  }),
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'gpt-4o-mini',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User',
    });

    expect(result.data.summary).toBe('Valid summary text');
    expect(result.data.tags).toEqual(['tech', 'typescript']);
    expect(result.attempts).toBe(1);
    expect(result.tokens.totalTokens).toBe(150);
  });

  it('strips markdown code blocks and validates successfully', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 100, completion_tokens: 50 },
            choices: [
              {
                message: {
                  content:
                    '```json\n{\n  "summary": "Valid summary enclosed in markdown",\n  "tags": ["markdown"]\n}\n```',
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'gpt-4o-mini',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User',
    });

    expect(result.data.summary).toBe('Valid summary enclosed in markdown');
    expect(result.attempts).toBe(1);
  });

  it('retries when first response fails Zod validation and succeeds on second attempt', async () => {
    let callCount = 0;
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
              // Invalid: tags is empty array (fails .min(1))
              return {
                usage: { prompt_tokens: 100, completion_tokens: 50 },
                choices: [
                  { message: { content: JSON.stringify({ summary: 'Too short', tags: [] }) } },
                ],
              };
            }
            // Valid response on retry
            return {
              usage: { prompt_tokens: 120, completion_tokens: 60 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: 'Properly corrected summary',
                      tags: ['fixed'],
                    }),
                  },
                },
              ],
            };
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'gpt-4o-mini',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User',
      maxRetries: 2,
    });

    expect(result.attempts).toBe(2);
    expect(result.data.summary).toBe('Properly corrected summary');
    expect(callCount).toBe(2);
  });

  it('fails with a clear error after exhausting retries (attempt limit 3)', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 50, completion_tokens: 20 },
            choices: [{ message: { content: '{"invalid": "data"}' } }],
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'gpt-4o-mini',
        schema: TestSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
        maxRetries: 2,
      }),
    ).rejects.toThrow(/Output failed Zod schema validation after 2 retries/);
  });

  it('dynamically clamps max_tokens and retries when OpenRouter returns 402 affordability error', async () => {
    let callCount = 0;
    const requestedMaxTokens: number[] = [];

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params: { max_tokens: number }) => {
            callCount++;
            requestedMaxTokens.push(params.max_tokens);
            if (callCount === 1) {
              const err = new Error(
                '402 This request requires more credits, or fewer max_tokens. You requested up to 2000 tokens, but can only afford 1831.',
              );
              (err as unknown as { status: number }).status = 402;
              return Promise.reject(err);
            }
            return Promise.resolve({
              usage: { prompt_tokens: 100, completion_tokens: 50 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: 'Recovered after token clamp',
                      tags: ['recovery', 'clamping'],
                    }),
                  },
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'openai/gpt-4o',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User',
      maxTokens: 2000,
    });

    expect(callCount).toBe(2);
    expect(requestedMaxTokens[0]).toBe(2000);
    // 1831 * 0.95 = 1739
    expect(requestedMaxTokens[1]).toBe(1739);
    expect(result.data.summary).toBe('Recovered after token clamp');
  });

  it('throws clear actionable error when OpenRouter credits are completely insufficient', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const err = new Error(
              '402 This request requires more credits, or fewer max_tokens. You requested up to 2000 tokens, but can only afford 50.',
            );
            (err as unknown as { status: number }).status = 402;
            return Promise.reject(err);
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'openai/gpt-4o',
        schema: TestSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
        maxTokens: 2000,
      }),
    ).rejects.toThrow(/OpenRouter credit limit exceeded for model "openai\/gpt-4o"/);
  });
});
