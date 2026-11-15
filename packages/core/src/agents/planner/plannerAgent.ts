import OpenAI from 'openai';
import { GraphState, RunAgentMetrics } from '../../schemas/state.js';
import { ContentPlan, ContentPlanSchema } from '../../schemas/contentPlan.js';
import { createLLMClient, getAgentModel, getAgentMaxTokens, getAgentReasoningEffort } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { resolveBudgetLimits } from '../../llm/budget.js';
import { Tracer } from '../../observability/types.js';
import { buildPlannerSystemPrompt, buildPlannerUserPrompt } from './prompt.js';

export interface PlannerAgentOptions {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  reasoningEffort?: string;
  tracer?: Tracer;
}

export async function runPlannerAgent(
  state: GraphState,
  options: PlannerAgentOptions = {},
): Promise<{
  contentPlan: ContentPlan;
  tokensUsed: number;
  costUsd: number;
  agentMetrics: RunAgentMetrics;
}> {
  const client = options.client ?? createLLMClient({ role: 'writer' });
  const model = options.model ?? getAgentModel('writer');
  const tracer = options.tracer;

  const systemPrompt = buildPlannerSystemPrompt(state.config);
  const userPrompt = buildPlannerUserPrompt(state.topic, state.notes, state.config);

  const budgetLimits = resolveBudgetLimits(state.config);
  const result = await generateStructuredOutput({
    client,
    model,
    schema: ContentPlanSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: state.tokensUsed,
    currentCostUsd: state.costUsd,
    budgetLimits,
    runId: state.runId,
    agentRole: 'planner',
    maxTokens: options.maxTokens ?? getAgentMaxTokens('writer'),
    reasoningEffort: options.reasoningEffort ?? getAgentReasoningEffort('writer'),
    tracer,
  });

  const tokensDelta = result.tokens.totalTokens;
  const costDelta = result.costUsd;

  return {
    contentPlan: {
      redundantInformation: [],
      missingInformation: [],
      avoid: [],
      ...result.data,
    },
    tokensUsed: state.tokensUsed + tokensDelta,
    costUsd: Number((state.costUsd + costDelta).toFixed(4)),
    agentMetrics: {
      planner: {
        tokensUsed: tokensDelta,
        costUsd: costDelta,
        calls: 1,
      },
    },
  };
}
