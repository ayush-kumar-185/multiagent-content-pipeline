import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { Command } from '@langchain/langgraph';
import { createCiteWriterGraph } from './builder.js';
import { MockSearchProvider } from '../tools/search/mock.js';

describe('Phase 4: End-to-End Cooperative Multi-Agent Execution', () => {
  it('runs all 4 real agents cooperating from START to human review approval', async () => {
    const articleHtml = `
      <html>
        <head><title>PostgreSQL 16 Announcement</title></head>
        <body>
          <main>
            <h1>PostgreSQL 16 Released</h1>
            <p>PostgreSQL 16 introduces bidirectional logical replication between instances.</p>
            <p>Query parallelism has been expanded with SIMD instructions for modern x86 and ARM CPUs.</p>
          </main>
        </body>
      </html>
    `;

    const mockSearch = new MockSearchProvider({
      'PostgreSQL 16': [
        {
          title: 'PostgreSQL 16 Released',
          url: 'https://example.com/pg16-release',
          snippet: 'PostgreSQL 16 introduces bidirectional logical replication.',
        },
      ],
    });

    const mockFetch = vi.fn().mockImplementation(
      async () =>
        new Response(articleHtml, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
    );

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(async (params) => {
            const systemPrompt = params.messages[0]?.content ?? '';

            // 1. Researcher Agent
            if (systemPrompt.includes('Researcher Agent')) {
              return {
                usage: { prompt_tokens: 300, completion_tokens: 100 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        notes: [
                          {
                            id: 'n1',
                            claim: 'PostgreSQL 16 introduces bidirectional logical replication.',
                            sourceUrl: 'https://example.com/pg16-release',
                            quote:
                              'PostgreSQL 16 introduces bidirectional logical replication between instances.',
                            retrievedAt: new Date().toISOString(),
                          },
                        ],
                      }),
                    },
                  },
                ],
              };
            }

            // 2. Writer Agent
            if (systemPrompt.includes('Writer Agent')) {
              return {
                usage: { prompt_tokens: 350, completion_tokens: 120 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        draft: `# PostgreSQL 16 Architecture\n\nPostgreSQL 16 introduces bidirectional logical replication between instances [n1].`,
                      }),
                    },
                  },
                ],
              };
            }

            // 3. Fact-Checker Agent
            if (systemPrompt.includes('Fact-Checker Agent')) {
              return {
                usage: { prompt_tokens: 250, completion_tokens: 80 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        checks: [
                          {
                            claim:
                              'PostgreSQL 16 introduces bidirectional logical replication between instances.',
                            noteIds: ['n1'],
                            status: 'supported',
                            reason: 'Direct match with primary release quote.',
                          },
                        ],
                      }),
                    },
                  },
                ],
              };
            }

            // 4. Editor Agent
            if (systemPrompt.includes('Editor Agent')) {
              return {
                usage: { prompt_tokens: 200, completion_tokens: 70 },
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        score: 9.3,
                        feedback:
                          'Precise technical claims, accurate citation coverage, excellent flow.',
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
      useRealResearcher: true,
      useRealWriter: true,
      useRealFactChecker: true,
      useRealEditor: true,
      llmClient: mockClient,
      searchProvider: mockSearch,
      fetchOptions: { customFetch: mockFetch as unknown as typeof fetch },
    });

    const threadConfig = { configurable: { thread_id: 'e2e-all-agents-run' } };

    // Initial run
    await app.invoke(
      {
        runId: 'e2e-run-1',
        topic: 'PostgreSQL 16',
      },
      threadConfig,
    );

    const snapshot = await app.getState(threadConfig);
    expect(snapshot.next).toEqual(['humanReview']);
    expect(snapshot.values.status).toBe('awaiting_review');
    expect(snapshot.values.notes.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.values.claims.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.values.claimChecks.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.values.claimChecks[0]?.status).toBe('supported');
    expect(snapshot.values.editorVerdict?.decision).toBe('accept');

    // Resume with human approval
    const finalResult = await app.invoke(
      new Command({ resume: { action: 'approve' } }),
      threadConfig,
    );

    expect(finalResult.status).toBe('approved');
    expect(finalResult.humanAction?.action).toBe('approve');
  });
});
