import OpenAI from 'openai';
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
import { runResearcherAgent } from '../agents/researcher/researcherAgent.js';
import { runWriterAgent } from '../agents/writer/writerAgent.js';
import { runFactCheckerAgent } from '../agents/factChecker/factCheckerAgent.js';
import { runEditorAgent } from '../agents/editor/editorAgent.js';
import { SearchProvider } from '../tools/search/types.js';
import { FetchPageOptions } from '../tools/fetch/fetchPage.js';
import { BudgetExceededError } from '../llm/budget.js';
import { Tracer } from '../observability/types.js';

export interface NodeOptions {
  fakeAgentOptions?: FakeAgentOptions;
  useRealResearcher?: boolean;
  useRealWriter?: boolean;
  useRealFactChecker?: boolean;
  useRealEditor?: boolean;
  llmClient?: OpenAI;
  researcherModel?: string;
  writerModel?: string;
  factCheckerModel?: string;
  editorModel?: string;
  searchProvider?: SearchProvider;
  fetchOptions?: FetchPageOptions;
  tracer?: Tracer;
}

export function createGraphNodes(options: NodeOptions = {}) {
  const {
    fakeAgentOptions = {},
    useRealResearcher = false,
    useRealWriter = false,
    useRealFactChecker = false,
    useRealEditor = false,
    llmClient,
    researcherModel,
    writerModel,
    factCheckerModel,
    editorModel,
    searchProvider,
    fetchOptions,
    tracer,
  } = options;

  const researcherNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    if (state.status === 'budget_exceeded') {
      return {};
    }

    tracer?.startAgentSpan(state.runId, 'researcher');

    if (useRealResearcher) {
      try {
        const res = await runResearcherAgent(state, {
          client: llmClient,
          model: researcherModel,
          searchProvider,
          fetchOptions,
          tracer,
        });
        tracer?.endAgentSpan(state.runId, 'researcher', { notesCount: res.notes.length });
        return res;
      } catch (err: unknown) {
        tracer?.endAgentSpan(state.runId, 'researcher', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof BudgetExceededError) {
          return {
            status: 'budget_exceeded',
            openIssues: [...state.openIssues, `Budget guard breach in Researcher: ${err.message}`],
          };
        }
        throw err;
      }
    }

    const nextRound = state.researchRounds + 1;
    const newNotes = fakeAgentOptions.researcherBehavior
      ? fakeAgentOptions.researcherBehavior(nextRound)
      : defaultFakeNotes;

    // Deduplicate notes by ID
    const existingIds = new Set(state.notes.map((n) => n.id));
    const mergedNotes = [...state.notes, ...newNotes.filter((n) => !existingIds.has(n.id))];

    tracer?.endAgentSpan(state.runId, 'researcher', { notesCount: mergedNotes.length });

    return {
      researchRounds: nextRound,
      notes: mergedNotes,
      tokensUsed: state.tokensUsed + 500,
      costUsd: Number((state.costUsd + 0.005).toFixed(4)),
      agentMetrics: {
        researcher: {
          tokensUsed: 500,
          costUsd: 0.005,
          calls: 1,
        },
      },
    };
  };

  const writerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    if (state.status === 'budget_exceeded') {
      return {};
    }

    tracer?.startAgentSpan(state.runId, 'writer');

    if (useRealWriter) {
      try {
        const res = await runWriterAgent(state, {
          client: llmClient,
          model: writerModel,
          tracer,
        });
        tracer?.endAgentSpan(state.runId, 'writer', { claimsCount: res.claims.length });
        return res;
      } catch (err: unknown) {
        tracer?.endAgentSpan(state.runId, 'writer', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof BudgetExceededError) {
          return {
            status: 'budget_exceeded',
            openIssues: [...state.openIssues, `Budget guard breach in Writer: ${err.message}`],
          };
        }
        throw err;
      }
    }

    // Default / Stub writer
    const nextCycle = state.writeCycles + 1;
    const { draft, claims } = fakeAgentOptions.writerBehavior
      ? fakeAgentOptions.writerBehavior(nextCycle, state.notes)
      : { draft: defaultFakeDraft, claims: defaultFakeClaims };

    tracer?.endAgentSpan(state.runId, 'writer', { claimsCount: claims.length });

    return {
      writeCycles: nextCycle,
      draft,
      claims,
      tokensUsed: state.tokensUsed + 1200,
      costUsd: Number((state.costUsd + 0.015).toFixed(4)),
      agentMetrics: {
        writer: {
          tokensUsed: 1200,
          costUsd: 0.015,
          calls: 1,
        },
      },
    };
  };

  const factCheckerNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    if (state.status === 'budget_exceeded') {
      return {};
    }

    tracer?.startAgentSpan(state.runId, 'factChecker');

    if (useRealFactChecker) {
      try {
        const res = await runFactCheckerAgent(state, {
          client: llmClient,
          model: factCheckerModel,
          fetchOptions,
          tracer,
        });
        tracer?.endAgentSpan(state.runId, 'factChecker', { checksCount: res.claimChecks.length });
        return res;
      } catch (err: unknown) {
        tracer?.endAgentSpan(state.runId, 'factChecker', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof BudgetExceededError) {
          return {
            status: 'budget_exceeded',
            openIssues: [
              ...state.openIssues,
              `Budget guard breach in Fact-Checker: ${err.message}`,
            ],
          };
        }
        throw err;
      }
    }

    const claimChecks = fakeAgentOptions.factCheckerBehavior
      ? fakeAgentOptions.factCheckerBehavior(state.claims, state.notes)
      : defaultFakeClaimChecks;

    tracer?.endAgentSpan(state.runId, 'factChecker', { checksCount: claimChecks.length });

    return {
      claimChecks,
      tokensUsed: state.tokensUsed + 800,
      costUsd: Number((state.costUsd + 0.008).toFixed(4)),
      agentMetrics: {
        factChecker: {
          tokensUsed: 800,
          costUsd: 0.008,
          calls: 1,
        },
      },
    };
  };

  const editorNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    if (state.status === 'budget_exceeded') {
      return {};
    }

    tracer?.startAgentSpan(state.runId, 'editor');

    if (useRealEditor) {
      try {
        const res = await runEditorAgent(state, {
          client: llmClient,
          model: editorModel,
          tracer,
        });
        tracer?.endAgentSpan(state.runId, 'editor', { verdict: res.editorVerdict.decision });
        return res;
      } catch (err: unknown) {
        tracer?.endAgentSpan(state.runId, 'editor', {
          error: err instanceof Error ? err.message : String(err),
        });
        if (err instanceof BudgetExceededError) {
          return {
            status: 'budget_exceeded',
            openIssues: [...state.openIssues, `Budget guard breach in Editor: ${err.message}`],
          };
        }
        throw err;
      }
    }

    // Default / Stub editor
    const editorVerdict = fakeAgentOptions.editorBehavior
      ? fakeAgentOptions.editorBehavior(state.draft, state.claims, state.writeCycles)
      : defaultFakeEditorVerdict;

    tracer?.endAgentSpan(state.runId, 'editor', { verdict: editorVerdict.decision });

    return {
      editorVerdict,
      tokensUsed: state.tokensUsed + 600,
      costUsd: Number((state.costUsd + 0.006).toFixed(4)),
      agentMetrics: {
        editor: {
          tokensUsed: 600,
          costUsd: 0.006,
          calls: 1,
        },
      },
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

    // If budget was exceeded, keep status as budget_exceeded; otherwise awaiting_review
    const finalStatus = state.status === 'budget_exceeded' ? 'budget_exceeded' : 'awaiting_review';

    return {
      status: finalStatus,
      openIssues: Array.from(new Set(issues)),
    };
  };

  const humanReviewNode = async (state: GraphState): Promise<Partial<GraphState>> => {
    const rawResume = interrupt({
      message:
        state.status === 'budget_exceeded'
          ? 'Article draft routed to review due to budget limit breach'
          : 'Article draft requires human review',
      runId: state.runId,
      topic: state.topic,
      draft: state.draft,
      claims: state.claims,
      claimChecks: state.claimChecks,
      editorVerdict: state.editorVerdict,
      openIssues: state.openIssues,
      status: state.status,
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
