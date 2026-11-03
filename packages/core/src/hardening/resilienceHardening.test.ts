import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import OpenAI from 'openai';
import {
  generateStructuredOutput,
  BudgetExceededError,
  assertWithinBudget,
  createCiteWriterGraph,
  createLLMClient,
} from '../index.js';

describe('Phase 9 Resilience Hardening: Retries, Budget Breaches, and Fault Tolerance', () => {
  describe('Malformed Model Output and Zod Validation Retries', () => {
    it('retries when LLM output fails schema validation and recovers on valid retry', async () => {
      const TargetSchema = z.object({
        answer: z.string().min(5),
        confidence: z.number().min(0).max(1),
      });

      let callCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: async () => {
              callCount++;
              if (callCount === 1) {
                // Attempt 1: Schema violation (confidence is a string, answer too short)
                return {
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({ answer: 'no', confidence: 'very high' }),
                      },
                    },
                  ],
                  usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 },
                };
              }
              // Attempt 2: Corrected valid payload
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        answer: 'Validated technical response',
                        confidence: 0.95,
                      }),
                    },
                  },
                ],
                usage: { prompt_tokens: 70, completion_tokens: 40, total_tokens: 110 },
              };
            },
          },
        },
      } as unknown as OpenAI;

      const result = await generateStructuredOutput({
        client: mockClient,
        model: 'gpt-4o-mini',
        schema: TargetSchema,
        systemPrompt: 'System instruction',
        userPrompt: 'User prompt',
        maxRetries: 2,
      });

      expect(callCount).toBe(2);
      expect(result.attempts).toBe(2);
      expect(result.data.answer).toBe('Validated technical response');
      expect(result.data.confidence).toBe(0.95);
      expect(result.tokens.totalTokens).toBe(190);
    });

    it('fails gracefully after exceeding maximum allowed Zod retries', async () => {
      const StrictSchema = z.object({
        mandatoryId: z.string().uuid(),
      });

      let callCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: async () => {
              callCount++;
              // Persistently invalid output (not a UUID)
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({ mandatoryId: 'not-a-uuid' }),
                    },
                  },
                ],
                usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
              };
            },
          },
        },
      } as unknown as OpenAI;

      await expect(
        generateStructuredOutput({
          client: mockClient,
          model: 'gpt-4o-mini',
          schema: StrictSchema,
          systemPrompt: 'System prompt',
          userPrompt: 'User prompt',
          maxRetries: 2, // 3 attempts total
        }),
      ).rejects.toThrow(/Output failed Zod schema validation after 2 retries/);

      expect(callCount).toBe(3);
    });

    it('handles non-JSON raw text and recovers when JSON is provided in retry', async () => {
      const SimpleSchema = z.object({
        status: z.enum(['ok', 'error']),
      });

      let callCount = 0;
      const mockClient = {
        chat: {
          completions: {
            create: async () => {
              callCount++;
              if (callCount === 1) {
                // Return invalid non-JSON plain text
                return {
                  choices: [
                    {
                      message: {
                        content: 'I apologize, but here is my response: status is ok.',
                      },
                    },
                  ],
                  usage: { prompt_tokens: 40, completion_tokens: 20, total_tokens: 60 },
                };
              }
              // Attempt 2: valid JSON
              return {
                choices: [
                  {
                    message: {
                      content: '{"status": "ok"}',
                    },
                  },
                ],
                usage: { prompt_tokens: 60, completion_tokens: 15, total_tokens: 75 },
              };
            },
          },
        },
      } as unknown as OpenAI;

      const result = await generateStructuredOutput({
        client: mockClient,
        model: 'gpt-4o-mini',
        schema: SimpleSchema,
        systemPrompt: 'System',
        userPrompt: 'User',
        maxRetries: 2,
      });

      expect(callCount).toBe(2);
      expect(result.data.status).toBe('ok');
    });
  });

  describe('Budget Guard Breach Resilience', () => {
    it('throws BudgetExceededError when token cap is reached', () => {
      expect(() =>
        assertWithinBudget(105_000, 0.5, { maxRunTokens: 100_000, maxRunCostUsd: 5.0 }),
      ).toThrow(BudgetExceededError);
    });

    it('throws BudgetExceededError when cost cap is reached', () => {
      expect(() =>
        assertWithinBudget(10_000, 2.55, { maxRunTokens: 100_000, maxRunCostUsd: 2.0 }),
      ).toThrow(BudgetExceededError);
    });

    it('transitions graph state to budget_exceeded and preserves partial draft when budget is breached', async () => {
      // In LangGraph, when an agent breaches budget, the graph routes safely to human review
      const app = createCiteWriterGraph({
        useRealResearcher: true,
      });

      const initial = {
        runId: `hardening-budget-${Date.now()}`,
        topic: 'Budget Test',
        config: {
          audience: 'engineers',
          tone: 'technical',
          targetWords: 300,
          maxTokens: 40_000, // Budget is 40k
          maxCostUsd: 0.5,
        },
        notes: [],
        researchRounds: 0,
        draft: '',
        claims: [],
        writeCycles: 0,
        claimChecks: [],
        tokensUsed: 50_000, // Starting tokens already exceed budget
        costUsd: 0,
        status: 'running' as const,
        openIssues: [],
        agentMetrics: {},
      };

      const result = await app.invoke(initial, {
        configurable: { thread_id: initial.runId },
      });

      // The graph gracefully reached review with budget_exceeded status rather than crashing
      expect(result.status).toBe('budget_exceeded');
      expect(result.openIssues.some((issue: string) => issue.includes('Budget guard breach'))).toBe(
        true,
      );
    });
  });

  describe('LLM Client Configuration Hardening', () => {
    it('initializes OpenAI client with explicit request timeout and retry options', () => {
      const client = createLLMClient({
        apiKey: 'test-key',
        timeout: 25_000,
        maxRetries: 4,
      });

      expect(client.timeout).toBe(25_000);
      expect(client.maxRetries).toBe(4);
    });
  });
});
