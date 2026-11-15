import OpenAI from 'openai';
import { z } from 'zod';
import { GraphState, RunAgentMetrics } from '../../schemas/state.js';
import { Note, NoteSchema } from '../../schemas/note.js';
import { SearchProvider } from '../../tools/search/types.js';
import { createSearchProvider } from '../../tools/search/factory.js';
import { fetchPage, FetchPageOptions } from '../../tools/fetch/fetchPage.js';
import { filterVerifiedNotes } from './quoteVerifier.js';
import { deduplicateNotes } from './noteDeduplication.js';
import { PassageSelectorOptions } from './passageSelector.js';
import { createLLMClient, getAgentModel, getAgentMaxTokens, getAgentReasoningEffort } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { resolveBudgetLimits, assertWithinBudget } from '../../llm/budget.js';
import { Tracer } from '../../observability/types.js';
import {
  buildResearcherSystemPrompt,
  buildResearcherInitialPrompt,
  buildResearcherReResearchPrompt,
  buildResearcherCoverageReResearchPrompt,
} from './prompt.js';
import { evaluateCoverageGate } from '../../graph/coverageGate.js';

export const MAX_FETCHES_PER_ROUND = 8;

export const ResearcherOutputSchema = z.object({
  notes: z.array(NoteSchema),
});

export type ResearcherOutput = z.infer<typeof ResearcherOutputSchema>;

export interface ResearcherAgentOptions {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: string;
  searchProvider?: SearchProvider;
  fetchOptions?: FetchPageOptions;
  maxFetchesPerRound?: number;
  tracer?: Tracer;
  pageTokenBudget?: number;
  passageOptions?: PassageSelectorOptions;
}

export async function runResearcherAgent(
  state: GraphState,
  options: ResearcherAgentOptions = {},
): Promise<{
  notes: Note[];
  researchRounds: number;
  tokensUsed: number;
  costUsd: number;
  agentMetrics: RunAgentMetrics;
}> {
  const client = options.client ?? createLLMClient({ role: 'researcher' });
  const model = options.model ?? getAgentModel('researcher');
  const searchProvider = options.searchProvider ?? createSearchProvider();
  const maxFetches = options.maxFetchesPerRound ?? MAX_FETCHES_PER_ROUND;
  const tracer = options.tracer;

  // Upfront Budget Guard Check before executing any tool or network operations
  const limits = resolveBudgetLimits(state.config);
  assertWithinBudget(state.tokensUsed, state.costUsd, limits);

  const isReResearch = state.researchRounds > 0;
  const claimsNeedingResearch = state.claimChecks.filter((c) => c.status === 'needs_more_research');
  const coverage = evaluateCoverageGate(state.topic, state.notes, state.draft);

  // 1. Gather Search Queries
  const queries: string[] = [];
  if (isReResearch && claimsNeedingResearch.length > 0) {
    for (const c of claimsNeedingResearch) {
      queries.push(`${state.topic} ${c.claim.slice(0, 80)}`);
    }
  } else if (isReResearch && coverage.isThin) {
    if (coverage.missingKeyTerms.length > 0) {
      for (const term of coverage.missingKeyTerms) {
        queries.push(`${state.topic} ${term}`);
      }
    }
    queries.push(`${state.topic} documentation guide`);
  } else {
    queries.push(state.topic);
    queries.push(`${state.topic} architecture documentation`);
  }

  // 2. Perform Searches & Collect Allowed URLs
  const allowedUrls = new Set<string>();
  if (state.sourceUrl) {
    allowedUrls.add(state.sourceUrl);
  }
  // Pre-seed with any existing note source URLs
  for (const n of state.notes) {
    allowedUrls.add(n.sourceUrl);
  }

  for (const query of queries) {
    const searchStart = Date.now();
    try {
      const results = await searchProvider.search(query, 4);
      const latencyMs = Date.now() - searchStart;

      if (tracer && state.runId) {
        tracer.recordToolCall(state.runId, {
          agentRole: 'researcher',
          toolName: 'web_search',
          input: { query },
          output: { count: results.length, urls: results.map((r) => r.url) },
          latencyMs,
          success: true,
        });
      }

      for (const res of results) {
        if (res.url) {
          allowedUrls.add(res.url);
        }
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - searchStart;
      if (tracer && state.runId) {
        tracer.recordToolCall(state.runId, {
          agentRole: 'researcher',
          toolName: 'web_search',
          input: { query },
          latencyMs,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      console.warn(`Search error for query "${query}":`, err);
    }
  }

  // 3. Fetch Pages with Cap (Max 8 per round)
  const candidateUrls = Array.from(allowedUrls).slice(0, maxFetches);
  const fetchedPages: Array<{ url: string; title: string; rawText: string; wrappedText: string }> =
    [];
  const rawTextsByUrl = new Map<string, string>();

  for (const url of candidateUrls) {
    const fetchStart = Date.now();
    try {
      const pageResult = await fetchPage(url, options.fetchOptions);
      const latencyMs = Date.now() - fetchStart;

      if (tracer && state.runId) {
        tracer.recordToolCall(state.runId, {
          agentRole: 'researcher',
          toolName: 'fetch_page',
          input: { url },
          output: { title: pageResult.title, length: pageResult.rawText.length },
          latencyMs,
          success: true,
        });
      }

      if (pageResult.rawText && pageResult.rawText.length > 20) {
        fetchedPages.push(pageResult);
        rawTextsByUrl.set(url, pageResult.rawText);
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - fetchStart;
      if (tracer && state.runId) {
        tracer.recordToolCall(state.runId, {
          agentRole: 'researcher',
          toolName: 'fetch_page',
          input: { url },
          latencyMs,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Continue to next URL on fetch errors (SSRF, timeout, 404, etc.)
      console.warn(
        `Failed to fetch candidate URL "${url}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // If no pages could be fetched, return existing state with round incremented
  if (fetchedPages.length === 0) {
    return {
      notes: state.notes,
      researchRounds: state.researchRounds + 1,
      tokensUsed: state.tokensUsed,
      costUsd: state.costUsd,
      agentMetrics: {
        researcher: {
          tokensUsed: 0,
          costUsd: 0,
          calls: 0,
        },
      },
    };
  }

  // 4. Prompt LLM to extract notes
  const passageOptions: PassageSelectorOptions = {
    tokenBudget: options.pageTokenBudget,
    ...options.passageOptions,
  };
  const systemPrompt = buildResearcherSystemPrompt();
  let userPrompt: string;
  if (isReResearch && claimsNeedingResearch.length > 0) {
    userPrompt = buildResearcherReResearchPrompt(
      claimsNeedingResearch,
      fetchedPages,
      passageOptions,
    );
  } else if (isReResearch && coverage.isThin) {
    userPrompt = buildResearcherCoverageReResearchPrompt(
      state.topic,
      coverage.instruction || 'Gather additional verified notes covering distinct subtopics.',
      coverage.missingKeyTerms,
      state.notes,
      fetchedPages,
      passageOptions,
    );
  } else {
    userPrompt = buildResearcherInitialPrompt(state.topic, fetchedPages, passageOptions);
  }

  const budgetLimits = resolveBudgetLimits(state.config);
  const result = await generateStructuredOutput({
    client,
    model,
    schema: ResearcherOutputSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: state.tokensUsed,
    currentCostUsd: state.costUsd,
    budgetLimits,
    runId: state.runId,
    agentRole: 'researcher',
    maxTokens: options.maxTokens ?? getAgentMaxTokens('researcher'),
    reasoningEffort: options.reasoningEffort ?? getAgentReasoningEffort('researcher'),
    tracer,
  });

  // 5. Code-level Substring Verification (Drop unverified notes)
  const verification = filterVerifiedNotes(result.data.notes, rawTextsByUrl);

  // 6. Merge & Deduplicate Verified Notes
  const { mergedNotes } = deduplicateNotes(state.notes, verification.verifiedNotes);

  const tokensDelta = result.tokens.totalTokens;
  const costDelta = result.costUsd;

  return {
    notes: mergedNotes,
    researchRounds: state.researchRounds + 1,
    tokensUsed: state.tokensUsed + tokensDelta,
    costUsd: Number((state.costUsd + costDelta).toFixed(4)),
    agentMetrics: {
      researcher: {
        tokensUsed: tokensDelta,
        costUsd: costDelta,
        calls: 1,
      },
    },
  };
}
