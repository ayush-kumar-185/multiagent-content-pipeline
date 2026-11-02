import OpenAI from 'openai';
import { GraphState } from '../../schemas/state.js';
import { EditorVerdict, EditorVerdictSchema } from '../../schemas/editor.js';
import { createLLMClient, getAgentModel } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { runDeterministicEditorChecks } from './deterministicChecks.js';
import { buildEditorSystemPrompt, buildEditorUserPrompt } from './prompt.js';

export interface EditorAgentOptions {
  client?: OpenAI;
  model?: string;
}

export async function runEditorAgent(
  state: GraphState,
  options: EditorAgentOptions = {},
): Promise<{
  editorVerdict: EditorVerdict;
  tokensUsed: number;
  costUsd: number;
}> {
  const client = options.client ?? createLLMClient();
  const model = options.model ?? getAgentModel('editor');

  const deterministicReport = runDeterministicEditorChecks(state.draft, state.claims, state.config);

  const systemPrompt = buildEditorSystemPrompt(state.config);
  const userPrompt = buildEditorUserPrompt(state.draft, deterministicReport);

  const result = await generateStructuredOutput({
    client,
    model,
    schema: EditorVerdictSchema,
    systemPrompt,
    userPrompt,
    currentTokensUsed: state.tokensUsed,
    currentCostUsd: state.costUsd,
  });

  return {
    editorVerdict: result.data,
    tokensUsed: state.tokensUsed + result.tokens.totalTokens,
    costUsd: Number((state.costUsd + result.costUsd).toFixed(4)),
  };
}
