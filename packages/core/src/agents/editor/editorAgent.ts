import OpenAI from 'openai';
import { GraphState, RunAgentMetrics } from '../../schemas/state.js';
import { EditorVerdict, EditorVerdictSchema, QualityScores } from '../../schemas/editor.js';
import { createLLMClient, getAgentModel, getAgentMaxTokens, getAgentReasoningEffort } from '../../llm/client.js';
import { generateStructuredOutput } from '../../llm/structuredOutput.js';
import { resolveBudgetLimits } from '../../llm/budget.js';
import { Tracer } from '../../observability/types.js';
import { runDeterministicEditorChecks } from './deterministicChecks.js';
import { buildEditorSystemPrompt, buildEditorUserPrompt } from './prompt.js';
import { calculateWeightedScore, evaluateHardGates, resolveEditorDecision } from './scoring.js';

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
  const verdict: EditorVerdict = {
    strengths: [],
    weaknesses: [],
    missingInformation: [],
    redundantSections: [],
    revisionInstructions: [],
    repetitionFindings: [],
    ...result.data,
  };

  // Combine deterministic repetition findings with LLM findings
  const allRepetitionFindings = [
    ...(deterministicReport.repetitionFindings || []),
    ...(verdict.repetitionFindings || []),
  ];
  const seenFindings = new Set<string>();
  const deduplicatedRepetitionFindings = allRepetitionFindings.filter((rf) => {
    const key = `${rf.sectionIds.join(',')}:${rf.repeatedIdea}`;
    if (seenFindings.has(key)) return false;
    seenFindings.add(key);
    return true;
  });
  verdict.repetitionFindings = deduplicatedRepetitionFindings;

  // Compute or validate quality scores
  let overallScore = verdict.score;
  if (verdict.scores) {
    overallScore = calculateWeightedScore(verdict.scores);
    verdict.overallScore = overallScore;
    verdict.score = overallScore;
  } else {
    const s = verdict.score;
    const scores: QualityScores = {
      factualReliability: s,
      relevance: s,
      depth: s,
      logicalFlow: s,
      originality: s,
      engagement: s,
      repetitionControl: deduplicatedRepetitionFindings.some((r) => r.severity === 'high') ? 4 : s,
      readability: deterministicReport.fleschScore >= 50 ? s : Math.min(s, 6),
      conclusionQuality: s,
    };
    verdict.scores = scores;
    verdict.overallScore = s;
    verdict.score = s;
  }

  // Evaluate hard quality gates
  const hardGates = evaluateHardGates(verdict.scores, {
    claimChecks: state.claimChecks,
    repetitionFindings: deduplicatedRepetitionFindings,
    formatPassed: deterministicReport.lengthPassed,
  });

  // Resolve final decision (enforces gates regardless of what LLM guessed)
  const finalDecision = resolveEditorDecision(overallScore, hardGates, verdict.decision);
  verdict.decision = finalDecision;

  if (!hardGates.passed && finalDecision !== 'accept') {
    verdict.feedback = `${verdict.feedback}\n\n[Quality Gate Violations]:\n${hardGates.failedGates.map((g) => `- ${g}`).join('\n')}`;
  }

  return {
    editorVerdict: verdict,
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
