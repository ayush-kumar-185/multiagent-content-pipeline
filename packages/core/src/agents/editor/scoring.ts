import { QualityScores, EditorDecision, RepetitionFinding } from '../../schemas/editor.js';
import { ClaimCheck } from '../../schemas/claim.js';

export const SCORE_WEIGHTS = {
  factualReliability: 0.2,
  relevance: 0.15,
  depth: 0.15,
  logicalFlow: 0.1,
  originality: 0.1,
  engagement: 0.1,
  repetitionControl: 0.1,
  readability: 0.05,
  conclusionQuality: 0.05,
} as const;

export interface QualityGateResult {
  passed: boolean;
  failedGates: string[];
}

/**
 * Deterministically computes the weighted quality score from the 9 quality dimensions.
 * Weighted sum is rounded to 1 decimal place (0.0 - 10.0 scale).
 */
export function calculateWeightedScore(scores: QualityScores): number {
  const rawScore =
    scores.factualReliability * SCORE_WEIGHTS.factualReliability +
    scores.relevance * SCORE_WEIGHTS.relevance +
    scores.depth * SCORE_WEIGHTS.depth +
    scores.logicalFlow * SCORE_WEIGHTS.logicalFlow +
    scores.originality * SCORE_WEIGHTS.originality +
    scores.engagement * SCORE_WEIGHTS.engagement +
    scores.repetitionControl * SCORE_WEIGHTS.repetitionControl +
    scores.readability * SCORE_WEIGHTS.readability +
    scores.conclusionQuality * SCORE_WEIGHTS.conclusionQuality;

  return Math.max(0, Math.min(10, Math.round(rawScore * 10) / 10));
}

export interface HardGateEvaluationOptions {
  claimChecks?: ClaimCheck[];
  repetitionFindings?: RepetitionFinding[];
  formatPassed?: boolean;
  hasCentralAnswer?: boolean;
}

/**
 * Evaluates mandatory hard quality gates.
 * Hard gates prevent high scores in non-factual dimensions from masking critical factual or structural defects.
 */
export function evaluateHardGates(
  scores: QualityScores,
  options: HardGateEvaluationOptions = {},
): QualityGateResult {
  const failedGates: string[] = [];

  // Gate 1: Unsupported material factual claim or causal leap
  const hasUnsupportedClaim =
    options.claimChecks &&
    options.claimChecks.some(
      (c) =>
        c.status === 'unsupported' ||
        c.status === 'contradicted' ||
        c.auditRecord?.supportClassification === 'unsupported' ||
        (c.auditRecord?.makesCausalInference && c.auditRecord?.causalSupported === false),
    );
  if (hasUnsupportedClaim || scores.factualReliability < 7.0) {
    failedGates.push('Material factual claims are unsupported, contradicted, contain unverified causal leaps, or factual reliability is below threshold (< 7.0)');
  }

  // Gate 2: Severe semantic repetition or redundant explanations
  const hasHighRepetition = options.repetitionFindings?.some((r) => r.severity === 'high');
  if (hasHighRepetition || scores.repetitionControl < 6.0 || (scores.redundantExplanations !== undefined && scores.redundantExplanations < 6.0)) {
    failedGates.push('Severe semantic repetition or redundant explanations detected across multiple sections/tweets (< 6.0)');
  }

  // Gate 3: Missing central answer or core relevance
  if (options.hasCentralAnswer === false || scores.relevance < 6.0) {
    failedGates.push('Draft failed to directly answer the central question or topic (< 6.0)');
  }

  // Gate 4: Evidence-to-claim precision and causal reasoning
  if (scores.evidenceToClaimPrecision !== undefined && scores.evidenceToClaimPrecision < 7.0) {
    failedGates.push('Evidence-to-claim precision is below acceptable threshold (< 7.0)');
  }
  if (scores.causalReasoning !== undefined && scores.causalReasoning < 6.0) {
    failedGates.push('Unsupported causal reasoning or unverified physiological mechanisms detected (< 6.0)');
  }
  if (scores.numericalTraceability !== undefined && scores.numericalTraceability < 6.0) {
    failedGates.push('Numerical statistics presented without experimental context or study conditions (< 6.0)');
  }
  if (scores.industryClaimGroundedness !== undefined && scores.industryClaimGroundedness < 6.0) {
    failedGates.push('Industry or corporate practices claimed without independent documentary evidence (< 6.0)');
  }
  if (scores.narrativeContinuity !== undefined && scores.narrativeContinuity < 6.0) {
    failedGates.push('Disjointed narrative flow or missing logical transitions between disparate domains (< 6.0)');
  }

  // Gate 5: Major format violation
  if (options.formatPassed === false) {
    failedGates.push('Major format requirement violated (e.g. word count, thread structure)');
  }

  return {
    passed: failedGates.length === 0,
    failedGates,
  };
}

/**
 * Determines final accept/revise/reject decision based on weighted score AND hard gates.
 */
export function resolveEditorDecision(
  overallScoreOrScores: number | QualityScores,
  hardGates?: QualityGateResult,
  requestedDecision?: EditorDecision,
): EditorDecision {
  let score: number;
  let gates: QualityGateResult;

  if (typeof overallScoreOrScores === 'number') {
    score = overallScoreOrScores;
    gates = hardGates ?? { passed: true, failedGates: [] };
  } else {
    score = calculateWeightedScore(overallScoreOrScores);
    gates = hardGates ?? evaluateHardGates(overallScoreOrScores);
  }

  // If hard gates failed, draft CANNOT be accepted
  if (!gates.passed) {
    if (score < 4.0) {
      return 'reject';
    }
    return 'revise';
  }

  if (requestedDecision === 'reject' || score < 4.0) {
    return 'reject';
  }

  // 7.5+ is strong and acceptable
  if (score >= 7.5) {
    return 'accept';
  }

  return 'revise';
}
