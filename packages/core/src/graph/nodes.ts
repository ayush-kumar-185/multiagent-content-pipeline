import { interrupt } from '@langchain/langgraph';
import { GraphState, HumanActionSchema, type HumanAction } from '../schemas/state.js';
import {
  FakeAgentOptions,
  defaultFakeNotes,
  defaultFakeDraft,
  defaultFakeClaims,
  defaultFakeClaimChecks,
  defaultFakeEditorVerdict,
} from './fakeAgents.js';
import { MAX_RESEARCH_ROUNDS, MAX_WRITE_CYCLES } from './routes.js';

export function createGraphNodes(options: FakeAgentOptions = {}) {
  const researcherNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const nextRound = state.researchRounds + 1;
    const newNotes = options.researcherBehavior
      ? options.researcherBehavior(nextRound)
      : defaultFakeNotes;

    // Deduplicate notes by ID
    const existingIds = new Set(state.notes.map((n) => n.id));
    const mergedNotes = [...state.notes, ...newNotes.filter((n) => !existingIds.has(n.id))];

    return {
      researchRounds: nextRound,
      notes: mergedNotes,
      tokensUsed: state.tokensUsed + 500,
      costUsd: Number((state.costUsd + 0.005).toFixed(4)),
    };
  };

  const writerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const nextCycle = state.writeCycles + 1;
    const { draft, claims } = options.writerBehavior
      ? options.writerBehavior(nextCycle, state.notes)
      : { draft: defaultFakeDraft, claims: defaultFakeClaims };

    return {
      writeCycles: nextCycle,
      draft,
      claims,
      tokensUsed: state.tokensUsed + 1200,
      costUsd: Number((state.costUsd + 0.015).toFixed(4)),
    };
  };

  const factCheckerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const claimChecks = options.factCheckerBehavior
      ? options.factCheckerBehavior(state.claims, state.notes)
      : defaultFakeClaimChecks;

    return {
      claimChecks,
      tokensUsed: state.tokensUsed + 800,
      costUsd: Number((state.costUsd + 0.008).toFixed(4)),
    };
  };

  const editorNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const editorVerdict = options.editorBehavior
      ? options.editorBehavior(state.draft, state.claims, state.writeCycles)
      : defaultFakeEditorVerdict;

    return {
      editorVerdict,
      tokensUsed: state.tokensUsed + 600,
      costUsd: Number((state.costUsd + 0.006).toFixed(4)),
    };
  };

  const prepareReviewNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const issues: string[] = [...state.openIssues];

    // Check if cap hit on research
    const needsResearch = state.claimChecks.filter((c) => c.status === 'needs_more_research');
    if (needsResearch.length > 0 && state.researchRounds >= MAX_RESEARCH_ROUNDS) {
      for (const item of needsResearch) {
        issues.push(
          `Research cap reached (${state.researchRounds}/${MAX_RESEARCH_ROUNDS}): Unresolved claim "${item.claim}"`,
        );
      }
    }

    // Check if cap hit on unsupported claims
    const unsupported = state.claimChecks.filter((c) => c.status === 'unsupported');
    if (unsupported.length > 0 && state.writeCycles >= MAX_WRITE_CYCLES) {
      for (const item of unsupported) {
        issues.push(
          `Write cap reached (${state.writeCycles}/${MAX_WRITE_CYCLES}): Unsupported claim "${item.claim}" (${item.reason})`,
        );
      }
    }

    // Check if cap hit on editor revision
    if (state.editorVerdict?.decision === 'revise' && state.writeCycles >= MAX_WRITE_CYCLES) {
      issues.push(
        `Write cap reached (${state.writeCycles}/${MAX_WRITE_CYCLES}): Editor feedback unresolved: "${state.editorVerdict.feedback}"`,
      );
    }

    return {
      status: 'awaiting_review',
      openIssues: Array.from(new Set(issues)),
    };
  };

  const humanReviewNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const rawResume = interrupt({
      message: 'Article draft requires human review',
      runId: state.runId,
      topic: state.topic,
      draft: state.draft,
      claims: state.claims,
      claimChecks: state.claimChecks,
      editorVerdict: state.editorVerdict,
      openIssues: state.openIssues,
    });

    const parsedAction: HumanAction = HumanActionSchema.parse(rawResume);

    if (parsedAction.action === 'approve') {
      return {
        status: 'approved',
        humanAction: parsedAction,
      };
    }

    if (parsedAction.action === 'edit') {
      return {
        status: 'approved',
        draft: parsedAction.editedDraft ?? state.draft,
        humanAction: parsedAction,
      };
    }

    // Reject action
    return {
      status: 'rejected',
      humanAction: parsedAction,
    };
  };

  return {
    researcherNode,
    writerNode,
    factCheckerNode,
    editorNode,
    prepareReviewNode,
    humanReviewNode,
  };
}
