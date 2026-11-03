import OpenAI from 'openai';
import { z } from 'zod';
import { GraphState, RunAgentMetrics } from '../../schemas/state.js';
import { Claim } from '../../schemas/claim.js';
import { createLLMClient, getAgentModel } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { resolveBudgetLimits } from '../../llm/budget.js';
import { Tracer } from '../../observability/types.js';
import { parseCitationsFromDraft } from './citationParser.js';
import {
  buildWriterSystemPrompt,
  buildWriterInitialPrompt,
  buildWriterRevisionPrompt,
} from './prompt.js';

export const WriterOutputSchema = z.object({
  draft: z.string().min(20, 'Draft must not be empty'),
});

export type WriterOutput = z.infer<typeof WriterOutputSchema>;

export interface WriterAgentOptions {
  client?: OpenAI;
  model?: string;
  tracer?: Tracer;
}

export async function runWriterAgent(
  state: GraphState,
  options: WriterAgentOptions = {},
): Promise<{
  draft: string;
  claims: Claim[];
  writeCycles: number;
  tokensUsed: number;
  costUsd: number;
  agentMetrics: RunAgentMetrics;
}> {
  const client = options.client ?? createLLMClient();
  const model = options.model ?? getAgentModel('writer');
  const tracer = options.tracer;

  const systemPrompt = buildWriterSystemPrompt(state.config);

  const isRevision = state.writeCycles > 0;
  const userPrompt = isRevision
    ? buildWriterRevisionPrompt(
        state.draft,
        state.claimChecks.filter((c) => c.status !== 'supported'),
        state.editorVerdict,
      )
    : buildWriterInitialPrompt(state.topic, state.notes);

  const budgetLimits = resolveBudgetLimits(state.config);
  const result = await generateStructuredOutput({
    client,
    model,
    schema: WriterOutputSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: state.tokensUsed,
    currentCostUsd: state.costUsd,
    budgetLimits,
    runId: state.runId,
    agentRole: 'writer',
    tracer,
  });

  const parsedClaims = parseCitationsFromDraft(result.data.draft);

  const tokensDelta = result.tokens.totalTokens;
  const costDelta = result.costUsd;

  return {
    draft: result.data.draft,
    claims: parsedClaims,
    writeCycles: state.writeCycles + 1,
    tokensUsed: state.tokensUsed + tokensDelta,
    costUsd: Number((state.costUsd + costDelta).toFixed(4)),
    agentMetrics: {
      writer: {
        tokensUsed: tokensDelta,
        costUsd: costDelta,
        calls: 1,
      },
    },
  };
}
