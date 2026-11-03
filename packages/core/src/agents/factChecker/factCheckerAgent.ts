import OpenAI from 'openai';
import { z } from 'zod';
import { GraphState } from '../../schemas/state.js';
import { Claim, ClaimCheck, ClaimCheckSchema } from '../../schemas/claim.js';
import { createLLMClient, getAgentModel } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { runDeterministicFactPreChecks } from './deterministicPreChecks.js';
import { buildFactCheckerSystemPrompt, buildFactCheckerUserPrompt } from './prompt.js';
import { fetchPage, FetchPageOptions } from '../../tools/fetch/fetchPage.js';

export const FactCheckerOutputSchema = z.object({
  checks: z.array(ClaimCheckSchema),
});

export type FactCheckerOutput = z.infer<typeof FactCheckerOutputSchema>;

export interface FactCheckerAgentOptions {
  client?: OpenAI;
  model?: string;
  fetchOptions?: FetchPageOptions;
  allowSourceFetch?: boolean;
}

export async function runFactCheckerAgent(
  state: GraphState,
  options: FactCheckerAgentOptions = {},
): Promise<{
  claimChecks: ClaimCheck[];
  tokensUsed: number;
  costUsd: number;
}> {
  const client = options.client ?? createLLMClient();
  const model = options.model ?? getAgentModel('factChecker');

  if (!state.claims || state.claims.length === 0) {
    return {
      claimChecks: [],
      tokensUsed: state.tokensUsed,
      costUsd: state.costUsd,
    };
  }

  const deterministicResults = new Map<string, ClaimCheck>();
  const claimsForLLM: Claim[] = [];

  // 1. Run Deterministic Pre-checks (Note existence & numbers matching)
  for (const claim of state.claims) {
    const preCheck = runDeterministicFactPreChecks(claim, state.notes);
    if (!preCheck.passed && preCheck.claimCheck) {
      deterministicResults.set(claim.claim, preCheck.claimCheck);
    } else {
      claimsForLLM.push(claim);
    }
  }

  let totalTokensUsed = state.tokensUsed;
  let totalCostUsd = state.costUsd;
  const llmResults = new Map<string, ClaimCheck>();

  // 2. If claims passed pre-checks, execute LLM verification
  if (claimsForLLM.length > 0) {
    // Optional source re-reading if enabled
    const sourceContexts = new Map<string, string>();
    if (options.allowSourceFetch) {
      const urlsToFetch = new Set<string>();
      for (const claim of claimsForLLM) {
        for (const noteId of claim.noteIds) {
          const note = state.notes.find((n) => n.id === noteId);
          if (note?.sourceUrl) {
            urlsToFetch.add(note.sourceUrl);
          }
        }
      }

      for (const url of Array.from(urlsToFetch).slice(0, 3)) {
        try {
          const page = await fetchPage(url, options.fetchOptions);
          if (page.rawText) {
            sourceContexts.set(url, page.rawText);
          }
        } catch {
          // Fallback cleanly to note quote alone if fetch fails
        }
      }
    }

    const systemPrompt = buildFactCheckerSystemPrompt();
    const userPrompt = buildFactCheckerUserPrompt(claimsForLLM, state.notes, sourceContexts);

    const result = await generateStructuredOutput({
      client,
      model,
      schema: FactCheckerOutputSchema,
      systemPrompt,
      userPrompt,
      currentTokensUsed: totalTokensUsed,
      currentCostUsd: totalCostUsd,
    });

    totalTokensUsed += result.tokens.totalTokens;
    totalCostUsd = Number((totalCostUsd + result.costUsd).toFixed(4));

    for (const check of result.data.checks) {
      llmResults.set(check.claim, check);
    }
  }

  // 3. Assemble results in original claim order
  const finalChecks: ClaimCheck[] = state.claims.map((claim) => {
    // Check deterministic pre-check first
    const detCheck = deterministicResults.get(claim.claim);
    if (detCheck) return detCheck;

    // Check LLM result
    const llmCheck = llmResults.get(claim.claim);
    if (llmCheck) return llmCheck;

    // Fallback if missing from LLM response
    return {
      claim: claim.claim,
      noteIds: claim.noteIds,
      status: 'needs_more_research' as const,
      reason: 'Claim was not evaluated by the model; flagged for further research.',
    };
  });

  return {
    claimChecks: finalChecks,
    tokensUsed: totalTokensUsed,
    costUsd: totalCostUsd,
  };
}
