import { describe, it, expect } from 'vitest';
import {
  NoteSchema,
  ClaimSchema,
  ClaimCheckSchema,
  EditorVerdictSchema,
  RunConfigSchema,
  GraphStateSchema,
} from './index.js';

describe('Zod Contracts and Schemas', () => {
  describe('NoteSchema', () => {
    it('validates a valid note', () => {
      const validNote = {
        id: 'n1',
        claim: 'TypeScript 5.0 introduced const type parameters.',
        sourceUrl: 'https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/',
        quote: 'TypeScript 5.0 includes const type parameters.',
        retrievedAt: new Date().toISOString(),
      };

      const result = NoteSchema.safeParse(validNote);
      expect(result.success).toBe(true);
    });

    it('rejects an invalid source URL', () => {
      const invalidNote = {
        id: 'n1',
        claim: 'Some claim',
        sourceUrl: 'not-a-valid-url',
        quote: 'Some quote',
        retrievedAt: new Date().toISOString(),
      };

      const result = NoteSchema.safeParse(invalidNote);
      expect(result.success).toBe(false);
    });

    it('rejects empty id or quote', () => {
      const invalidNote = {
        id: '',
        claim: 'Claim',
        sourceUrl: 'https://example.com',
        quote: '',
        retrievedAt: new Date().toISOString(),
      };

      const result = NoteSchema.safeParse(invalidNote);
      expect(result.success).toBe(false);
    });
  });

  describe('ClaimSchema and ClaimCheckSchema', () => {
    it('validates a valid claim', () => {
      const validClaim = {
        id: 'c1',
        claim: 'Postgres handles JSON querying efficiently.',
        noteIds: ['n1', 'n2'],
      };

      const result = ClaimSchema.safeParse(validClaim);
      expect(result.success).toBe(true);
    });

    it('rejects a claim with no note IDs', () => {
      const invalidClaim = {
        claim: 'Unsupported statement without notes.',
        noteIds: [],
      };

      const result = ClaimSchema.safeParse(invalidClaim);
      expect(result.success).toBe(false);
    });

    it('validates supported, unsupported, and needs_more_research claim checks', () => {
      const statuses = ['supported', 'unsupported', 'needs_more_research'] as const;
      for (const status of statuses) {
        const check = {
          claim: 'Fact check claim',
          noteIds: ['n1'],
          status,
          reason: 'Checking criteria met.',
        };
        expect(ClaimCheckSchema.safeParse(check).success).toBe(true);
      }
    });

    it('rejects an unknown check status', () => {
      const invalidCheck = {
        claim: 'Claim',
        noteIds: ['n1'],
        status: 'partially_true',
        reason: 'Invalid status',
      };

      const result = ClaimCheckSchema.safeParse(invalidCheck);
      expect(result.success).toBe(false);
    });
  });

  describe('EditorVerdictSchema', () => {
    it('accepts valid score and accept/revise decisions', () => {
      const acceptVerdict = {
        score: 9.5,
        feedback: 'Excellent clarity and verified claims throughout.',
        decision: 'accept',
      };
      expect(EditorVerdictSchema.safeParse(acceptVerdict).success).toBe(true);

      const reviseVerdict = {
        score: 6.0,
        feedback: 'Too technical for target audience; soften tone.',
        decision: 'revise',
      };
      expect(EditorVerdictSchema.safeParse(reviseVerdict).success).toBe(true);
    });

    it('rejects scores outside 0-10', () => {
      expect(
        EditorVerdictSchema.safeParse({
          score: 11,
          feedback: 'Too high',
          decision: 'accept',
        }).success,
      ).toBe(false);

      expect(
        EditorVerdictSchema.safeParse({
          score: -1,
          feedback: 'Too low',
          decision: 'revise',
        }).success,
      ).toBe(false);
    });
  });

  describe('RunConfigSchema', () => {
    it('applies standard defaults when optional fields are omitted', () => {
      const config = RunConfigSchema.parse({});
      expect(config.audience).toBe('software engineers');
      expect(config.tone).toBe('technical and precise');
      expect(config.targetWords).toBe(800);
    });
  });

  describe('GraphStateSchema', () => {
    it('validates a complete initial state with defaults', () => {
      const state = GraphStateSchema.parse({
        runId: 'run-123',
        topic: 'Drizzle ORM performance compared to Prisma',
        config: {},
      });

      expect(state.runId).toBe('run-123');
      expect(state.researchRounds).toBe(0);
      expect(state.writeCycles).toBe(0);
      expect(state.status).toBe('running');
      expect(state.notes).toEqual([]);
      expect(state.claims).toEqual([]);
      expect(state.claimChecks).toEqual([]);
      expect(state.openIssues).toEqual([]);
      expect(state.tokensUsed).toBe(0);
      expect(state.costUsd).toBe(0);
    });
  });
});
