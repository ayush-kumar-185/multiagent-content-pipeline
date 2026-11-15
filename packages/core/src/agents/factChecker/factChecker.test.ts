import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import { runDeterministicFactPreChecks, findUncitedSentencesInDraft } from './deterministicPreChecks.js';
import { runFactCheckerAgent } from './factCheckerAgent.js';
import { parseCitationsFromDraft } from '../writer/citationParser.js';
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

    it('ignores leading thread indices and counters (e.g. "1/", "2/7") in numeric verification', () => {
      const threadClaim = {
        id: 'c4',
        claim: '1/ Package size dropped by 37%.',
        noteIds: ['n1'],
      };
      const result = runDeterministicFactPreChecks(threadClaim, notes);
      expect(result.passed).toBe(true);
      expect(result.claimCheck).toBeUndefined();
    });

    it('SEEDED ERROR: flags uncited extrapolations containing numbers as unsupported in deterministic pre-check', () => {
      // Note n1 quote: "TypeScript 5.0 introduces const type parameters for improved inference. Package size dropped by 37%."
      // Extrapolated claim introduces 50% benefit not in the source note:
      const extrapolatedClaim = {
        id: 'c-extrapolated',
        claim: 'Const type parameters improve compiler speed by 50% in complex monorepos.',
        noteIds: ['n1'],
      };
      const result = runDeterministicFactPreChecks(extrapolatedClaim, notes);
      expect(result.passed).toBe(false);
      expect(result.claimCheck?.status).toBe('unsupported');
      expect(result.claimCheck?.reason).toContain(
        'Number "50%" in claim does not appear in cited note quote(s)',
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

  describe('Deterministic Uncited Sentence Detection (Fixture)', () => {
    const topic1Notes: Note[] = [
      {
        id: 'n1',
        claim:
          'TypeScript 5.0 introduces const type parameters that enable const-like inference by default.',
        sourceUrl:
          'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
        quote:
          'In TypeScript 5.0, you can now add a const modifier to a type parameter declaration to cause const-like inference to be the default:',
        retrievedAt: new Date().toISOString(),
      },
      {
        id: 'n2',
        claim:
          'TypeScript 5.0 allows the extends field in tsconfig.json to accept multiple entries.',
        sourceUrl:
          'https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html',
        quote:
          'To give some more flexibility here, Typescript 5.0 now allows the extends field to take multiple entries.',
        retrievedAt: new Date().toISOString(),
      },
      {
        id: 'n3',
        claim:
          'All enums are treated as union enums in TypeScript 5.0, even when some members are computed dynamically.',
        sourceUrl:
          'https://www.geeksforgeeks.org/typescript/typescript-5-0-updates-what-s-new',
        quote:
          'In TypeScript, enums were previously treated as sets of constants, where each member was its own type. TypeScript 5.0 improves this by treating all enums as union enums.',
        retrievedAt: new Date().toISOString(),
      },
      {
        id: 'n4',
        claim:
          'TypeScript 5.0 introduces a new bundler module resolution option that improves compatibility with modern bundlers like Webpack and Parcel.',
        sourceUrl:
          'https://www.geeksforgeeks.org/typescript/typescript-5-0-updates-what-s-new',
        quote:
          'TypeScript 5.0 introduces a new bundler module resolution option that improves compatibility with modern bundlers like Webpack and Parcel.',
        retrievedAt: new Date().toISOString(),
      },
      {
        id: 'n5',
        claim:
          'TypeScript 5.0 adds support for export * from "module" and export * as namespace from "module" re-exports.',
        sourceUrl:
          'https://blog.logrocket.com/exploring-typescript-5-features-smaller-simpler-faster',
        quote:
          'Although these flags can still be used in TypeScript 5.0, they will generate a warning from the compiler.',
        retrievedAt: new Date().toISOString(),
      },
    ];

    const lastAcceptedTopic1DraftFixture = `# Advances in TypeScript 5.0 Type Inference

TypeScript 5.0 introduces several significant updates to the language's type system and configuration capabilities. This article outlines the specific changes regarding type inference, enum handling, and module resolution as documented in the release notes.

## Const Type Parameters

TypeScript 5.0 introduces const type parameters that enable const-like inference by default [n1]. Developers can now add a const modifier to a type parameter declaration to cause const-like inference to be the default [n1]. This mechanism allows the compiler to infer literal types rather than widening them to their base types, providing a more precise type representation for generic functions and classes that rely on specific constant values.

## Enum Handling

In TypeScript, enums were previously treated as sets of constants, where each member was its own type [n3]. TypeScript 5.0 improves this by treating all enums as union enums [n3]. This change standardizes the type behavior of enums, ensuring that the type of an enum member is a union of its constituent literal types rather than a distinct nominal type for each member. This alignment simplifies type checking and reduces the need for explicit type assertions when working with enum values in generic contexts.

## Configuration and Module Resolution

To give more flexibility, TypeScript 5.0 now allows the extends field in tsconfig.json to take multiple entries [n2]. This capability enables developers to compose configuration files from multiple sources, such as a base organizational config and a project-specific override, without requiring manual merging of JSON structures. Additionally, TypeScript 5.0 introduces a new bundler module resolution option that improves compatibility with modern bundlers like Webpack and Parcel [n4]. This option adjusts how the compiler resolves module specifiers to match the behavior of these tools, ensuring that type checking aligns with the actual runtime resolution strategy used during the build process.

## Re-exports

Although these flags can still be used in TypeScript 5.0, they will generate a warning from the compiler [n5]. This warning serves as a signal to developers that certain legacy configuration options are deprecated or no longer recommended for new projects, encouraging the adoption of the updated module resolution and type inference features introduced in this release.`;

    it('flags all uncited why/how sentences in the last accepted Topic 1 draft fixture as unsupported', () => {
      const uncitedChecks = findUncitedSentencesInDraft(
        lastAcceptedTopic1DraftFixture,
        topic1Notes,
      );
      expect(uncitedChecks).toHaveLength(8);
      for (const check of uncitedChecks) {
        expect(check.status).toBe('unsupported');
        expect(check.reason).toContain('Deterministic check failed');
      }

      const claimsFlagged = uncitedChecks.map((c) => c.claim);
      expect(claimsFlagged).toContain(
        "TypeScript 5.0 introduces several significant updates to the language's type system and configuration capabilities.",
      );
      expect(claimsFlagged).toContain(
        'This mechanism allows the compiler to infer literal types rather than widening them to their base types, providing a more precise type representation for generic functions and classes that rely on specific constant values.',
      );
      expect(claimsFlagged).toContain(
        'This change standardizes the type behavior of enums, ensuring that the type of an enum member is a union of its constituent literal types rather than a distinct nominal type for each member.',
      );
      expect(claimsFlagged).toContain(
        'This alignment simplifies type checking and reduces the need for explicit type assertions when working with enum values in generic contexts.',
      );
    });

    it('integrates with runFactCheckerAgent so that uncited sentences in draft are returned as unsupported claimChecks even without LLM call', async () => {
      const citedClaims = parseCitationsFromDraft(lastAcceptedTopic1DraftFixture);

      const mockCompletion = {
        usage: { prompt_tokens: 300, completion_tokens: 150 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                checks: citedClaims.map((c) => ({
                  claim: c.claim,
                  noteIds: c.noteIds,
                  status: 'supported',
                  reason: 'Verified against source quote.',
                })),
              }),
            },
          },
        ],
      };

      const mockClient = {
        chat: { completions: { create: vi.fn().mockResolvedValue(mockCompletion) } },
      } as unknown as OpenAI;
      const state = GraphStateSchema.parse({
        runId: 'fixture-test',
        topic: 'Advances in TypeScript 5.0 Type Inference',
        draft: lastAcceptedTopic1DraftFixture,
        notes: topic1Notes,
        claims: citedClaims,
      });

      const result = await runFactCheckerAgent(state, {
        client: mockClient,
      });

      const unsupportedChecks = result.claimChecks.filter((c) => c.status === 'unsupported');
      expect(unsupportedChecks.length).toBeGreaterThanOrEqual(8);
      const uncitedReasons = unsupportedChecks.filter((c) =>
        c.reason.includes('Sentence has no citation marker'),
      );
      expect(uncitedReasons).toHaveLength(8);
    });
  });
});
