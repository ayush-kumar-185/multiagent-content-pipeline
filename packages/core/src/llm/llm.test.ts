import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import OpenAI from 'openai';
import { checkBudget, assertWithinBudget, BudgetExceededError } from './budget.js';
import { estimateCostUsd } from './cost.js';
import { generateStructuredOutput } from './structuredOutput.js';
import {
  createLLMClient,
  resolveProvider,
  normalizeModelForProvider,
  PROVIDER_DEFAULT_BASE_URLS,
} from './client.js';

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

  it('throws clear actionable error on 401 unauthorized', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const err = new Error('401 Invalid API Key');
            (err as unknown as { status: number }).status = 401;
            return Promise.reject(err);
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'gemini-2.5-flash',
        schema: TestSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
      }),
    ).rejects.toThrow(/Authentication failed for provider "GEMINI"/);
  });

  it('throws clear actionable error on 429 rate limit or quota exceeded', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            const err = new Error('429 Resource has been exhausted (e.g. check quota)');
            (err as unknown as { status: number }).status = 429;
            return Promise.reject(err);
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'llama-3.3-70b-versatile',
        schema: TestSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
      }),
    ).rejects.toThrow(/Rate limit or quota exceeded for provider "GROQ"/);
  });
});

describe('LLM Layer: Multi-Platform Provider Routing & Client Creation', () => {
  it('resolves providers correctly from explicit config and model names', () => {
    expect(resolveProvider({ provider: 'gemini' })).toBe('gemini');
    expect(resolveProvider({ provider: 'groq' })).toBe('groq');
    expect(resolveProvider({ provider: 'cerebras' })).toBe('cerebras');
    expect(resolveProvider({ provider: 'ollama' })).toBe('ollama');
    expect(resolveProvider({ model: 'gemini-2.5-flash' })).toBe('gemini');
    expect(resolveProvider({ model: 'llama-3.3-70b-versatile' })).toBe('groq');
  });

  it('correctly creates client with Google AI Studio (Gemini) endpoint', () => {
    const client = createLLMClient({ provider: 'gemini', apiKey: 'test-gemini-key' });
    expect(client.baseURL).toBe(PROVIDER_DEFAULT_BASE_URLS.gemini);
    expect(client.apiKey).toBe('test-gemini-key');
  });

  it('correctly creates client with Groq endpoint', () => {
    const client = createLLMClient({ provider: 'groq', apiKey: 'test-groq-key' });
    expect(client.baseURL).toBe(PROVIDER_DEFAULT_BASE_URLS.groq);
    expect(client.apiKey).toBe('test-groq-key');
  });

  it('correctly creates client with Cerebras endpoint', () => {
    const client = createLLMClient({ provider: 'cerebras', apiKey: 'test-cerebras-key' });
    expect(client.baseURL).toBe(PROVIDER_DEFAULT_BASE_URLS.cerebras);
    expect(client.apiKey).toBe('test-cerebras-key');
  });

  it('correctly creates client with Ollama local endpoint', () => {
    const client = createLLMClient({ provider: 'ollama' });
    expect(client.baseURL).toBe(PROVIDER_DEFAULT_BASE_URLS.ollama);
    expect(client.apiKey).toBe('ollama');
  });

  it('normalizes model names for different providers', () => {
    expect(normalizeModelForProvider('google/gemini-2.5-flash', 'gemini')).toBe('gemini-2.5-flash');
    expect(normalizeModelForProvider('groq/llama-3.3-70b-versatile', 'groq')).toBe(
      'llama-3.3-70b-versatile',
    );
    expect(normalizeModelForProvider('cerebras/llama3.3-70b', 'cerebras')).toBe('llama3.3-70b');
    expect(normalizeModelForProvider('meta-llama/llama-3.3-70b-instruct', 'cerebras')).toBe(
      'llama3.3-70b',
    );
    expect(normalizeModelForProvider('ollama/llama3.2', 'ollama')).toBe('llama3.2');
  });

  it('estimates costs correctly for Gemini, Groq, Cerebras, and Ollama', () => {
    // Gemini 2.5 Flash: $0.15/1M input, $0.60/1M output
    const geminiCost = estimateCostUsd('gemini-2.5-flash', 1000, 1000);
    expect(geminiCost).toBeCloseTo(0.00075, 5);

    // Cerebras Llama 3.3 70B: $0.60/1M input, $0.60/1M output
    const cerebrasCost = estimateCostUsd('llama3.3-70b', 1000, 1000);
    expect(cerebrasCost).toBeCloseTo(0.0012, 4);

    // Ollama: $0.00 (Local Free)
    const ollamaCost = estimateCostUsd('llama3.2', 10000, 5000);
    expect(ollamaCost).toBe(0);
  });
});
