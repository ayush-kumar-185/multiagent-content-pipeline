import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { runDeterministicFactPreChecks } from './deterministicPreChecks.js';
import { runFactCheckerAgent } from './factCheckerAgent.js';
import { Note } from '../../schemas/note.js';
import { GraphStateSchema } from '../../schemas/state.js';

describe('Fact-Checker: Deterministic Pre-Checks & Seeded Error Detection', () => {
  const notes: Note[] = [
    {
      id: 'n1',
      claim: 'TypeScript 5.0 introduced const type parameters.',
      sourceUrl: 'https://devblogs.microsoft.com/typescript/5-0',
      quote:
        'TypeScript 5.0 introduces const type parameters for improved inference. Package size dropped by 37%.',
      retrievedAt: new Date().toISOString(),
    },
    {
      id: 'n2',
      claim: 'Decorators standardized in TS 5.0',
      sourceUrl: 'https://devblogs.microsoft.com/typescript/5-0',
      quote:
        'In TypeScript 5.0, decorators can often reduce boilerplate up to 20% in specific web architectures.',
      retrievedAt: new Date().toISOString(),
    },
  ];

  describe('Deterministic Pre-Checks', () => {
    it('passes when cited note exists and all numbers in the claim match the quote', () => {
      const claim = {
        id: 'c1',
        claim: 'Package size dropped by 37%.',
        noteIds: ['n1'],
      };
      const result = runDeterministicFactPreChecks(claim, notes);
      expect(result.passed).toBe(true);
      expect(result.claimCheck).toBeUndefined();
    });

    it('SEEDED ERROR 1 (Fake Citation ID): immediately catches non-existent citation note ID as unsupported', () => {
      const claimWithFakeNote = {
        id: 'c2',
        claim: 'TypeScript 5.0 has great tooling support.',
        noteIds: ['n99'], // fake note ID
      };
      const result = runDeterministicFactPreChecks(claimWithFakeNote, notes);
      expect(result.passed).toBe(false);
      expect(result.claimCheck?.status).toBe('unsupported');
      expect(result.claimCheck?.reason).toContain(
        'Cited note ID "[n99]" does not exist in collected research notes',
      );
    });

    it('SEEDED ERROR 2 (Wrong Number): immediately catches hallucinated/wrong numbers as unsupported', () => {
      const claimWithWrongNumber = {
        id: 'c3',
        claim: 'Package size dropped by 80%.', // Quote states 37%
        noteIds: ['n1'],
      };
      const result = runDeterministicFactPreChecks(claimWithWrongNumber, notes);
      expect(result.passed).toBe(false);
      expect(result.claimCheck?.status).toBe('unsupported');
      expect(result.claimCheck?.reason).toContain(
        'Number "80%" in claim does not appear in cited note quote(s)',
      );
    });
  });

  describe('LLM Fact-Checker & Overstated Qualifier Detection', () => {
    it('SEEDED ERROR 3 (Overstated Qualifier): catches overstated qualifiers as unsupported via LLM', async () => {
      // Quote: "decorators can often reduce boilerplate up to 20% in specific web architectures"
      // Claim: "Decorators always eliminate all boilerplate in every web architecture"
      const claimOverstated = {
        id: 'c4',
        claim: 'Decorators always eliminate all boilerplate in every web architecture.',
        noteIds: ['n2'],
      };

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              usage: { prompt_tokens: 200, completion_tokens: 80 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      checks: [
                        {
                          claim: claimOverstated.claim,
                          noteIds: ['n2'],
                          status: 'unsupported',
                          reason:
                            'The claim overstates qualifiers: source quote states "can often reduce up to 20%", whereas the claim asserts "always eliminate all in every".',
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          },
        },
      } as unknown as OpenAI;

      const state = GraphStateSchema.parse({
        runId: 'seeded-qualifier-test',
        topic: 'TypeScript Decorators',
        notes,
        claims: [claimOverstated],
      });

      const result = await runFactCheckerAgent(state, { client: mockClient });

      expect(result.claimChecks).toHaveLength(1);
      expect(result.claimChecks[0]?.status).toBe('unsupported');
      expect(result.claimChecks[0]?.reason).toContain('overstates qualifiers');
    });

    it('SEEDED STATUS (Needs More Research): flags ambiguous claims lacking sufficient primary proof', async () => {
      const claimAmbiguous = {
        id: 'c5',
        claim: 'TypeScript 5.0 is the fastest TypeScript release in history.',
        noteIds: ['n1'],
      };

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              usage: { prompt_tokens: 200, completion_tokens: 70 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      checks: [
                        {
                          claim: claimAmbiguous.claim,
                          noteIds: ['n1'],
                          status: 'needs_more_research',
                          reason:
                            'Quote notes speedups and package size drop, but does not provide historical benchmark comparisons to verify "fastest in history".',
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          },
        },
      } as unknown as OpenAI;

      const state = GraphStateSchema.parse({
        runId: 'needs-more-research-test',
        topic: 'TypeScript 5.0 Speed',
        notes,
        claims: [claimAmbiguous],
      });

      const result = await runFactCheckerAgent(state, { client: mockClient });

      expect(result.claimChecks[0]?.status).toBe('needs_more_research');
      expect(result.claimChecks[0]?.reason).toContain('fastest in history');
    });

    it('SEEDED STATUS (Supported): confirms accurately cited claims matching source quote', async () => {
      const claimAccurate = {
        id: 'c6',
        claim: 'TypeScript 5.0 introduces const type parameters for improved inference.',
        noteIds: ['n1'],
      };

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              usage: { prompt_tokens: 200, completion_tokens: 60 },
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      checks: [
                        {
                          claim: claimAccurate.claim,
                          noteIds: ['n1'],
                          status: 'supported',
                          reason: 'Verbatim claim matches the cited primary release quote exactly.',
                        },
                      ],
                    }),
                  },
                },
              ],
            }),
          },
        },
      } as unknown as OpenAI;

      const state = GraphStateSchema.parse({
        runId: 'supported-test',
        topic: 'TypeScript 5.0 Const Parameters',
        notes,
        claims: [claimAccurate],
      });

      const result = await runFactCheckerAgent(state, { client: mockClient });

      expect(result.claimChecks[0]?.status).toBe('supported');
    });

    it('skips LLM calls entirely when all claims fail deterministic pre-checks', async () => {
      const claimFake = {
        id: 'c7',
        claim: 'Bogus claim without note.',
        noteIds: ['n999'],
      };

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
      } as unknown as OpenAI;

      const state = GraphStateSchema.parse({
        runId: 'deterministic-bypass-test',
        topic: 'Bypass Test',
        notes,
        claims: [claimFake],
      });

      const result = await runFactCheckerAgent(state, { client: mockClient });

      expect(mockClient.chat.completions.create).not.toHaveBeenCalled();
      expect(result.claimChecks[0]?.status).toBe('unsupported');
    });
  });
});
