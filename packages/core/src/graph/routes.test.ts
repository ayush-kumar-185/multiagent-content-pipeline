import { describe, it, expect } from 'vitest';
import {
  routeAfterFactChecker,
  routeAfterEditor,
  ROUTE_TARGETS,
  MAX_RESEARCH_ROUNDS,
  MAX_WRITE_CYCLES,
} from './routes.js';
import { GraphState, GraphStateSchema } from '../schemas/state.js';

function createMockState(overrides: Partial<GraphState> = {}): GraphState {
  return GraphStateSchema.parse({
    runId: 'test-run',
    topic: 'Test Topic',
    config: {},
    ...overrides,
  });
}

describe('Graph Routing Functions', () => {
  describe('routeAfterFactChecker (Route A)', () => {
    it('routes to researcher when claims need more research and researchRounds < cap', () => {
      const stateRound0 = createMockState({
        researchRounds: 0,
        claimChecks: [
          { claim: 'Claim 1', noteIds: ['n1'], status: 'supported', reason: 'ok' },
          { claim: 'Claim 2', noteIds: ['n2'], status: 'needs_more_research', reason: 'ambiguous' },
        ],
      });
      expect(routeAfterFactChecker(stateRound0)).toBe(ROUTE_TARGETS.RESEARCHER);

      const stateRound1 = createMockState({
        researchRounds: 1,
        claimChecks: [
          { claim: 'Claim 2', noteIds: ['n2'], status: 'needs_more_research', reason: 'ambiguous' },
        ],
      });
      expect(routeAfterFactChecker(stateRound1)).toBe(ROUTE_TARGETS.RESEARCHER);
    });

    it('routes to prepareReview when claims need more research but researchRounds >= cap', () => {
      const stateCapHit = createMockState({
        researchRounds: MAX_RESEARCH_ROUNDS, // 2
        claimChecks: [
          { claim: 'Claim 2', noteIds: ['n2'], status: 'needs_more_research', reason: 'ambiguous' },
        ],
      });
      expect(routeAfterFactChecker(stateCapHit)).toBe(ROUTE_TARGETS.PREPARE_REVIEW);
    });

    it('routes to writer when claims are unsupported and writeCycles < cap', () => {
      const stateCycle1 = createMockState({
        researchRounds: 1,
        writeCycles: 1,
        claimChecks: [
          { claim: 'Claim 1', noteIds: ['n1'], status: 'supported', reason: 'ok' },
          { claim: 'Claim 2', noteIds: ['n2'], status: 'unsupported', reason: 'wrong date' },
        ],
      });
      expect(routeAfterFactChecker(stateCycle1)).toBe(ROUTE_TARGETS.WRITER);

      const stateCycle2 = createMockState({
        writeCycles: 2,
        claimChecks: [
          { claim: 'Claim 2', noteIds: ['n2'], status: 'unsupported', reason: 'wrong date' },
        ],
      });
      expect(routeAfterFactChecker(stateCycle2)).toBe(ROUTE_TARGETS.WRITER);
    });

    it('routes to prepareReview when claims are unsupported but writeCycles >= cap', () => {
      const stateCapHit = createMockState({
        writeCycles: MAX_WRITE_CYCLES, // 3
        claimChecks: [
          { claim: 'Claim 2', noteIds: ['n2'], status: 'unsupported', reason: 'wrong date' },
        ],
      });
      expect(routeAfterFactChecker(stateCapHit)).toBe(ROUTE_TARGETS.PREPARE_REVIEW);
    });

    it('routes to editor when all claims are supported and coverage gate passes', () => {
      const dummyNotes = Array.from({ length: 5 }, (_, i) => ({
        id: `n${i + 1}`,
        claim: `Claim ${i + 1}`,
        sourceUrl: 'https://example.com',
        quote: `Quote for claim ${i + 1} with sufficient length.`,
        retrievedAt: new Date().toISOString(),
      }));
      const validDraft = Array(30)
        .fill('Test topic type inference provides literal inference [n1].')
        .join(' ');

      const stateAllSupportedAndCovered = createMockState({
        topic: 'Test topic type inference',
        notes: dummyNotes,
        draft: validDraft,
        claimChecks: [
          { claim: 'Claim 1', noteIds: ['n1'], status: 'supported', reason: 'verified' },
          { claim: 'Claim 2', noteIds: ['n2'], status: 'supported', reason: 'verified' },
        ],
      });
      expect(routeAfterFactChecker(stateAllSupportedAndCovered)).toBe(ROUTE_TARGETS.EDITOR);
    });

    it('routes to researcher when claims are supported but coverage is thin and researchRounds < cap', () => {
      const stateThinUnderCap = createMockState({
        topic: 'Test topic type inference',
        researchRounds: 1, // < MAX_RESEARCH_ROUNDS (2)
        notes: [], // 0 notes < 5
        draft: 'Short draft.', // < 250 words
        claimChecks: [
          { claim: 'Claim 1', noteIds: ['n1'], status: 'supported', reason: 'verified' },
        ],
      });
      expect(routeAfterFactChecker(stateThinUnderCap)).toBe(ROUTE_TARGETS.RESEARCHER);
    });

    it('routes to prepareReview when claims are supported but coverage is thin and researchRounds >= cap', () => {
      const stateThinCapReached = createMockState({
        topic: 'Test topic type inference',
        researchRounds: MAX_RESEARCH_ROUNDS, // 2
        notes: [], // 0 notes < 5
        draft: 'Short draft.', // < 250 words
        claimChecks: [
          { claim: 'Claim 1', noteIds: ['n1'], status: 'supported', reason: 'verified' },
        ],
      });
      expect(routeAfterFactChecker(stateThinCapReached)).toBe(ROUTE_TARGETS.PREPARE_REVIEW);
    });

    it('prioritizes needs_more_research over unsupported when under cap', () => {
      const stateBoth = createMockState({
        researchRounds: 1,
        writeCycles: 1,
        claimChecks: [
          { claim: 'Claim 1', noteIds: ['n1'], status: 'unsupported', reason: 'wrong date' },
          {
            claim: 'Claim 2',
            noteIds: ['n2'],
            status: 'needs_more_research',
            reason: 'source missing details',
          },
        ],
      });
      expect(routeAfterFactChecker(stateBoth)).toBe(ROUTE_TARGETS.RESEARCHER);
    });
  });

  describe('routeAfterEditor (Route B)', () => {
    it('routes to prepareReview when editor verdict is accept', () => {
      const stateAccept = createMockState({
        editorVerdict: {
          score: 9,
          feedback: 'Great article',
          decision: 'accept',
        },
      });
      expect(routeAfterEditor(stateAccept)).toBe(ROUTE_TARGETS.PREPARE_REVIEW);
    });

    it('routes to writer when editor verdict is revise and writeCycles < cap', () => {
      const stateReviseCycle1 = createMockState({
        writeCycles: 1,
        editorVerdict: {
          score: 6,
          feedback: 'Tone is too informal',
          decision: 'revise',
        },
      });
      expect(routeAfterEditor(stateReviseCycle1)).toBe(ROUTE_TARGETS.WRITER);

      const stateReviseCycle2 = createMockState({
        writeCycles: 2,
        editorVerdict: {
          score: 7,
          feedback: 'Shorten section 2',
          decision: 'revise',
        },
      });
      expect(routeAfterEditor(stateReviseCycle2)).toBe(ROUTE_TARGETS.WRITER);
    });

    it('routes to prepareReview when editor verdict is revise but writeCycles >= cap', () => {
      const stateReviseCapHit = createMockState({
        writeCycles: MAX_WRITE_CYCLES, // 3
        editorVerdict: {
          score: 6,
          feedback: 'Still too long',
          decision: 'revise',
        },
      });
      expect(routeAfterEditor(stateReviseCapHit)).toBe(ROUTE_TARGETS.PREPARE_REVIEW);
    });
  });
});
