import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import OpenAI from 'openai';
import { generateStructuredOutput } from './structuredOutput.js';
import { TruncatedOutputError } from './errors.js';

describe('Phase C: Truncation and Retry Handling', () => {
  const TestSchema = z.object({
    topic: z.string(),
    summary: z.string(),
  });

  const originalAudit = process.env.TOKEN_AUDIT;
  const originalCap = process.env.MAX_TRUNCATION_TOKENS;

  beforeEach(() => {
    delete process.env.TOKEN_AUDIT;
  });

  afterEach(() => {
    process.env.TOKEN_AUDIT = originalAudit;
    if (originalCap !== undefined) {
      process.env.MAX_TRUNCATION_TOKENS = originalCap;
    } else {
      delete process.env.MAX_TRUNCATION_TOKENS;
    }
  });

  it('treats Groq 400 "max completion tokens reached" as TruncatedOutput, retries once with elevated max_tokens, and succeeds', async () => {
    const recordedParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    let callCount = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params) => {
            recordedParams.push(params);
            callCount++;
            if (callCount === 1) {
              const err = new Error(
                '400 max completion tokens reached before generating a valid document',
              );
              (err as unknown as { status: number }).status = 400;
              (err as unknown as { error: unknown }).error = {
                message: 'max completion tokens reached before generating a valid document',
                code: 'json_validate_failed',
              };
              return Promise.reject(err);
            }
            return Promise.resolve({
              usage: { prompt_tokens: 100, completion_tokens: 50 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      topic: 'AI Architecture',
                      summary: 'Complete valid summary on second attempt',
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'openai/gpt-oss-120b',
      schema: TestSchema,
      systemPrompt: 'System instructions',
      userPrompt: 'Write article summary',
      maxTokens: 1000,
    });

    expect(callCount).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.data.topic).toBe('AI Architecture');

    // Attempt 1: maxTokens = 1000
    expect(recordedParams[0]?.max_tokens).toBe(1000);
    // Attempt 2: elevated max_tokens (1000 * 1.5 = 1500)
    expect(recordedParams[1]?.max_tokens).toBe(1500);
    // Attempt 2 reasoning_effort set to 'low'
    expect((recordedParams[1] as unknown as { reasoning_effort?: string })?.reasoning_effort).toBe(
      'low',
    );
    // Requirement 2: Do NOT resend full prompt unchanged; prompt updated with concise hint
    const retryUserPrompt = recordedParams[1]?.messages[1]?.content;
    expect(String(retryUserPrompt)).toContain('truncated at previous max_tokens limit');
  });

  it('fails with TruncatedOutputError when 400 truncation persists after 1 retry', async () => {
    let callCount = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const err = new Error(
              '400 max completion tokens reached before generating a valid document',
            );
            (err as unknown as { status: number }).status = 400;
            (err as unknown as { error: unknown }).error = {
              message: 'max completion tokens reached before generating a valid document',
            };
            return Promise.reject(err);
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'openai/gpt-oss-120b',
        schema: TestSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
        maxTokens: 1200,
      }),
    ).rejects.toThrow(TruncatedOutputError);

    // Strictly capped at at most 1 retry (2 calls total)
    expect(callCount).toBe(2);
  });

  it('treats HTTP 200 with finish_reason="length" as TruncatedOutput and retries once', async () => {
    const recordedParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    let callCount = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params) => {
            recordedParams.push(params);
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                usage: { prompt_tokens: 100, completion_tokens: 800 },
                choices: [
                  {
                    message: { content: '{"topic": "AI", "summary": "Truncated cut off here...' },
                    finish_reason: 'length',
                  },
                ],
              });
            }
            return Promise.resolve({
              usage: { prompt_tokens: 110, completion_tokens: 150 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      topic: 'AI',
                      summary: 'Now complete with higher token cap',
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'openai/gpt-oss-120b',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User prompt',
      maxTokens: 800,
    });

    expect(callCount).toBe(2);
    expect(result.attempts).toBe(2);
    expect(result.data.summary).toBe('Now complete with higher token cap');
    expect(recordedParams[1]?.max_tokens).toBe(1300); // 800 * 1.5 = 1200 -> max(1200, 800+500) = 1300
  });

  it('fails with TruncatedOutputError when finish_reason="length" persists after 1 retry', async () => {
    let callCount = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            return Promise.resolve({
              usage: { prompt_tokens: 100, completion_tokens: 800 },
              choices: [
                {
                  message: { content: '{"topic": "Incomplete...' },
                  finish_reason: 'length',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    await expect(
      generateStructuredOutput({
        client: mockClient,
        model: 'openai/gpt-oss-120b',
        schema: TestSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
        maxTokens: 800,
      }),
    ).rejects.toThrow(TruncatedOutputError);

    // Capped at 1 retry: total 2 calls
    expect(callCount).toBe(2);
  });

  it('on Zod validation failure: appends ONLY the validation error list, NOT the invalid assistant response', async () => {
    const recordedParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    let callCount = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params) => {
            recordedParams.push(JSON.parse(JSON.stringify(params)));
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                usage: { prompt_tokens: 80, completion_tokens: 40 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        unexpectedField: 'invalid schema content that is very long',
                      }),
                    },
                    finish_reason: 'stop',
                  },
                ],
              });
            }
            return Promise.resolve({
              usage: { prompt_tokens: 95, completion_tokens: 30 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      topic: 'Valid Topic',
                      summary: 'Valid Summary',
                    }),
                  },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    const result = await generateStructuredOutput({
      client: mockClient,
      model: 'qwen/qwen3.8-27b',
      schema: TestSchema,
      systemPrompt: 'System prompt text',
      userPrompt: 'User prompt text',
      maxRetries: 2,
    });

    expect(callCount).toBe(2);
    expect(result.data.topic).toBe('Valid Topic');

    // Call 2 messages verification:
    const call2Messages = recordedParams[1]?.messages ?? [];
    // Must contain exactly 2 messages (system + user), NOT 3 or 4 messages!
    expect(call2Messages.length).toBe(2);

    // Assistant role MUST NOT be present in history
    const hasAssistant = call2Messages.some((m) => m.role === 'assistant');
    expect(hasAssistant).toBe(false);

    // The user prompt must contain only the validation error details
    const call2UserPrompt = String(call2Messages[1]?.content);
    expect(call2UserPrompt).toContain('Field "topic": Required');
    expect(call2UserPrompt).toContain('Field "summary": Required');
    // Does NOT contain the invalid response content
    expect(call2UserPrompt).not.toContain('invalid schema content that is very long');
  });

  it('enforces MAX_TRUNCATION_TOKENS environment cap on retry', async () => {
    process.env.MAX_TRUNCATION_TOKENS = '2200';
    const recordedParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming[] = [];
    let callCount = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params) => {
            recordedParams.push(params);
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                usage: { prompt_tokens: 50, completion_tokens: 2000 },
                choices: [{ message: { content: '{"cut": ' }, finish_reason: 'length' }],
              });
            }
            return Promise.resolve({
              usage: { prompt_tokens: 50, completion_tokens: 40 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({ topic: 'Capped', summary: 'Fits in cap' }),
                  },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    await generateStructuredOutput({
      client: mockClient,
      model: 'openai/gpt-oss-120b',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User',
      maxTokens: 2000,
    });

    expect(callCount).toBe(2);
    // 2000 * 1.5 = 3000, but capped at 2200
    expect(recordedParams[1]?.max_tokens).toBe(2200);
  });

  it('sets reasoning effort to "low" by default for structured output steps', async () => {
    let capturedParams: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming | null = null;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation((params) => {
            capturedParams = params;
            return Promise.resolve({
              usage: { prompt_tokens: 20, completion_tokens: 20 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({ topic: 'T', summary: 'S' }),
                  },
                  finish_reason: 'stop',
                },
              ],
            });
          }),
        },
      },
    } as unknown as OpenAI;

    await generateStructuredOutput({
      client: mockClient,
      model: 'openai/gpt-oss-120b',
      schema: TestSchema,
      systemPrompt: 'System',
      userPrompt: 'User',
    });

    expect(
      (capturedParams as unknown as { reasoning_effort?: string })?.reasoning_effort,
    ).toBe('low');
  });
});

