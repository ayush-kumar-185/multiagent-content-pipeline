import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { Command } from '@langchain/langgraph';
import { Note } from '../schemas/note.js';
import { runWriterAgent } from './writer/writerAgent.js';
import { runEditorAgent } from './editor/editorAgent.js';
import { createCiteWriterGraph } from '../graph/builder.js';
import { GraphStateSchema } from '../schemas/state.js';

describe('Phase 2 Integration: Writer, Editor, Revision Loop & Budget Guard', () => {
  const handWrittenNotes: Note[] = [
    {
      id: 'n1',
      claim: 'PostgreSQL 16 introduced bidirectional logical replication between databases.',
      sourceUrl: 'https://www.postgresql.org/about/news/postgresql-16-released-2703/',
      quote: 'PostgreSQL 16 adds support for bidirectional logical replication.',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'n2',
      claim: 'PostgreSQL 16 includes improvements to query parallelism and SIMD CPU acceleration.',
      sourceUrl: 'https://www.postgresql.org/about/news/postgresql-16-released-2703/',
      quote: 'PostgreSQL 16 expands query parallelism and uses SIMD instructions.',
      retrievedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  it('Writer produces a cited markdown draft from hand-written notes and parses claims', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 300, completion_tokens: 150 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    draft: `# PostgreSQL 16 Performance and Replication\n\nPostgreSQL 16 adds support for bidirectional logical replication [n1]. Furthermore, query parallelism and SIMD CPU acceleration received major updates [n2].`,
                  }),
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const state = GraphStateSchema.parse({
      runId: 'writer-test-1',
      topic: 'PostgreSQL 16 Innovations',
      notes: handWrittenNotes,
      config: { audience: 'DBAs', tone: 'technical', targetWords: 300 },
    });

    const result = await runWriterAgent(state, { client: mockClient });

    expect(result.writeCycles).toBe(1);
    expect(result.draft).toContain('[n1]');
    expect(result.draft).toContain('[n2]');
    expect(result.claims).toHaveLength(2);
    expect(result.claims[0]?.noteIds).toContain('n1');
    expect(result.claims[1]?.noteIds).toContain('n2');
    expect(result.tokensUsed).toBe(450);
  });

  it('Editor evaluates draft, computes readability & citations, and returns verdict', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            usage: { prompt_tokens: 250, completion_tokens: 80 },
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    score: 9.2,
                    feedback: 'Strong technical density, rigorous citations, and clear flow.',
                    decision: 'accept',
                  }),
                },
              },
            ],
          }),
        },
      },
    } as unknown as OpenAI;

    const state = GraphStateSchema.parse({
      runId: 'editor-test-1',
      topic: 'PostgreSQL 16 Innovations',
      draft: `# PostgreSQL 16\n\nPostgreSQL 16 adds support for bidirectional logical replication [n1]. Query parallelism received SIMD optimization [n2].`,
      claims: [
        { id: 'c1', claim: 'Bidirectional replication support', noteIds: ['n1'] },
        { id: 'c2', claim: 'SIMD optimization', noteIds: ['n2'] },
      ],
      config: { targetWords: 50 },
    });

    const result = await runEditorAgent(state, { client: mockClient });

    expect(result.editorVerdict.decision).toBe('accept');
    expect(result.editorVerdict.score).toBe(9.2);
    expect(result.editorVerdict.feedback).toContain('Strong technical density');
    expect(result.tokensUsed).toBe(330);
  });

  it('Revision Loop: Editor requests revision and Writer fixes issues in cycle 2', async () => {
    let writerCalls = 0;
    let editorCalls = 0;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params) => {
            const systemPrompt = params.messages[0]?.content ?? '';

            if (systemPrompt.includes('Writer Agent')) {
              writerCalls++;
              if (writerCalls === 1) {
                // Draft 1
                return {
                  usage: { prompt_tokens: 200, completion_tokens: 100 },
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          draft: `# PostgreSQL 16 Overview\n\nPostgres has replication [n1]. Also query improvements [n2].`,
                        }),
                      },
                    },
                  ],
                };
              }
              // Revised Draft 2
              return {
                usage: { prompt_tokens: 300, completion_tokens: 150 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        draft: `# PostgreSQL 16 Architecture\n\nPostgreSQL 16 adds support for bidirectional logical replication [n1]. Query parallelism has been expanded with SIMD instructions [n2].`,
                      }),
                    },
                  },
                ],
              };
            }

            if (systemPrompt.includes('Editor Agent')) {
              editorCalls++;
              if (editorCalls === 1) {
                // First editor review: revise
                return {
                  usage: { prompt_tokens: 150, completion_tokens: 50 },
                  choices: [
                    {
                      message: {
                        content: JSON.stringify({
                          score: 6.5,
                          feedback: 'Tone is too casual; specify full feature names.',
                          decision: 'revise',
                        }),
                      },
                    },
                  ],
                };
              }
              // Second editor review: accept
              return {
                usage: { prompt_tokens: 180, completion_tokens: 60 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        score: 9.0,
                        feedback: 'Revised draft is clear, technical, and precise.',
                        decision: 'accept',
                      }),
                    },
                  },
                ],
              };
            }

            throw new Error(`Unexpected prompt: ${systemPrompt}`);
          }),
        },
      },
    } as unknown as OpenAI;

    const app = createCiteWriterGraph({
      useRealWriter: true,
      useRealEditor: true,
      llmClient: mockClient,
      fakeAgentOptions: {
        // Fact checker confirms claims as supported
        factCheckerBehavior: (claims) =>
          claims.map((c) => ({
            claim: c.claim,
            noteIds: c.noteIds,
            status: 'supported' as const,
            reason: 'Verified against notes.',
          })),
      },
    });

    const threadConfig = { configurable: { thread_id: 'test-revision-loop-p2' } };

    await app.invoke(
      {
        runId: 'revision-p2',
        topic: 'PostgreSQL 16',
        notes: handWrittenNotes,
      },
      threadConfig,
    );

    const state = await app.getState(threadConfig);
    expect(writerCalls).toBe(2);
    expect(editorCalls).toBe(2);
    expect(state.values.writeCycles).toBe(2);
    expect(state.values.editorVerdict?.decision).toBe('accept');
    expect(state.values.status).toBe('awaiting_review');

    // Resume with approval
    const finalResult = await app.invoke(
      new Command({ resume: { action: 'approve' } }),
      threadConfig,
    );
    expect(finalResult.status).toBe('approved');
  });

  it('Budget Guard: stops a run and routes to human review when limits are set very low', async () => {
    const originalTokens = process.env.MAX_RUN_TOKENS;
    const originalCost = process.env.MAX_RUN_COST_USD;

    // Set budget limit extremely low (10 tokens)
    process.env.MAX_RUN_TOKENS = '10';
    process.env.MAX_RUN_COST_USD = '0.0001';

    try {
      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              usage: { prompt_tokens: 50, completion_tokens: 50 },
              choices: [{ message: { content: '{"draft": "..."}' } }],
            }),
          },
        },
      } as unknown as OpenAI;

      const app = createCiteWriterGraph({
        useRealWriter: true,
        useRealEditor: true,
        llmClient: mockClient,
      });

      const threadConfig = { configurable: { thread_id: 'test-budget-breach' } };

      // Initial invocation will trigger budget guard inside writer because tokens exceed limit
      await app.invoke(
        {
          runId: 'budget-test',
          topic: 'Budget Limit Test',
          tokensUsed: 15, // already over the 10 token limit
          costUsd: 0.0002,
        },
        threadConfig,
      );

      const state = await app.getState(threadConfig);
      // Status must be budget_exceeded and paused for human review
      expect(state.values.status).toBe('budget_exceeded');
      expect(state.values.openIssues.length).toBeGreaterThan(0);
      expect(state.values.openIssues[0]).toContain('Budget guard breach');
      expect(state.next).toEqual(['humanReview']);

      // Human can review and approve/reject the partial result
      const finalResume = await app.invoke(
        new Command({ resume: { action: 'approve' } }),
        threadConfig,
      );
      expect(finalResume.status).toBe('approved');
    } finally {
      process.env.MAX_RUN_TOKENS = originalTokens;
      process.env.MAX_RUN_COST_USD = originalCost;
    }
  });
});
