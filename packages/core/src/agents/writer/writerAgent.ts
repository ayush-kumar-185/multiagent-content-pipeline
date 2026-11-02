import OpenAI from 'openai';
import { z } from 'zod';
import { GraphState } from '../../schemas/state.js';
import { Claim } from '../../schemas/claim.js';
import { createLLMClient, getAgentModel } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
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
}> {
  const client = options.client ?? createLLMClient();
  const model = options.model ?? getAgentModel('writer');

  const systemPrompt = buildWriterSystemPrompt(state.config);

  const isRevision = state.writeCycles > 0;
  const userPrompt = isRevision
    ? buildWriterRevisionPrompt(
        state.draft,
        state.claimChecks.filter((c) => c.status !== 'supported'),
        state.editorVerdict,
      )
    : buildWriterInitialPrompt(state.topic, state.notes);

  const result = await generateStructuredOutput({
    client,
    model,
    schema: WriterOutputSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: state.tokensUsed,
    currentCostUsd: state.costUsd,
  });

  const parsedClaims = parseCitationsFromDraft(result.data.draft);

  return {
    draft: result.data.draft,
    claims: parsedClaims,
    writeCycles: state.writeCycles + 1,
    tokensUsed: state.tokensUsed + result.tokens.totalTokens,
    costUsd: Number((state.costUsd + result.costUsd).toFixed(4)),
  };
}
