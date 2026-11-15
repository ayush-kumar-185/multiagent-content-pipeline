import OpenAI from 'openai';
import { GraphState, RunAgentMetrics } from '../../schemas/state.js';
import { EditorVerdict, EditorVerdictSchema } from '../../schemas/editor.js';
import { createLLMClient, getAgentModel, getAgentMaxTokens, getAgentReasoningEffort } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { resolveBudgetLimits } from '../../llm/budget.js';
import { Tracer } from '../../observability/types.js';
import { runDeterministicEditorChecks } from './deterministicChecks.js';
import { buildEditorSystemPrompt, buildEditorUserPrompt } from './prompt.js';

export interface EditorAgentOptions {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: string;
  tracer?: Tracer;
}

export async function runEditorAgent(
  state: GraphState,
  options: EditorAgentOptions = {},
): Promise<{
  editorVerdict: EditorVerdict;
  tokensUsed: number;
  costUsd: number;
  agentMetrics: RunAgentMetrics;
}> {
  const client = options.client ?? createLLMClient({ role: 'editor' });
  const model = options.model ?? getAgentModel('editor');
  const tracer = options.tracer;

  const deterministicReport = runDeterministicEditorChecks(
    state.draft,
    state.claims,
    state.config,
    state.claimChecks,
  );

  const systemPrompt = buildEditorSystemPrompt(state.config);
  const userPrompt = buildEditorUserPrompt(state.draft, deterministicReport, state.topic);

  const budgetLimits = resolveBudgetLimits(state.config);
  const result = await generateStructuredOutput({
    client,
    model,
    schema: EditorVerdictSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: state.tokensUsed,
    currentCostUsd: state.costUsd,
    budgetLimits,
    runId: state.runId,
    agentRole: 'editor',
    maxTokens: options.maxTokens ?? getAgentMaxTokens('editor'),
    reasoningEffort: options.reasoningEffort ?? getAgentReasoningEffort('editor'),
    tracer,
  });

  const tokensDelta = result.tokens.totalTokens;
  const costDelta = result.costUsd;

  return {
    editorVerdict: result.data,
    tokensUsed: state.tokensUsed + tokensDelta,
    costUsd: Number((state.costUsd + costDelta).toFixed(4)),
    agentMetrics: {
      editor: {
        tokensUsed: tokensDelta,
        costUsd: costDelta,
        calls: 1,
      },
    },
  };
}
