import { ClaimCheck } from '@citewriter/core';
import { RunMetrics } from './types.js';

export interface SentenceAnalysis {
  totalSentences: number;
  citedSentences: number;
  coveragePercent: number;
}

/**
 * Extracts plain factual sentences from a markdown article, ignoring headers, dividers, etc.
 */
export function extractFactualSentences(draft: string): string[] {
  if (!draft || !draft.trim()) return [];

  const sentences: string[] = [];
  const lines = draft.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('---') || line.startsWith('===')) {
      continue;
    }

    // Split sentence candidates by punctuation followed by space or line end,
    // avoiding splits if immediately followed by a citation like [n1]
    const rawSentences = line
      .split(/(?<=[.!?])(?!\s*\[n\d+)\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

    for (const s of rawSentences) {
      if (s.length > 5) {
        sentences.push(s);
      }
    }
  }

  return sentences;
}

/**
 * Calculates citation coverage: percentage of factual sentences that carry valid [n*] citations.
 */
export function calculateCitationCoverage(draft: string): SentenceAnalysis {
  const sentences = extractFactualSentences(draft);
  if (sentences.length === 0) {
    return {
      totalSentences: 0,
      citedSentences: 0,
      coveragePercent: 0,
    };
  }

  const citationPattern = /\[n\d+/;
  let citedCount = 0;

  for (const sentence of sentences) {
    if (citationPattern.test(sentence)) {
      citedCount++;
    }
  }

  const coveragePercent = Math.round((citedCount / sentences.length) * 1000) / 10;
  return {
    totalSentences: sentences.length,
    citedSentences: citedCount,
    coveragePercent,
  };
}

/**
 * Calculates unsupported claim rate from an array of ClaimChecks.
 */
export function calculateClaimStats(claimChecks: ClaimCheck[]): {
  totalClaims: number;
  supported: number;
  unsupported: number;
  needsResearch: number;
  unsupportedClaimRate: number; // 0 - 100%
} {
  const total = claimChecks.length;
  if (total === 0) {
    return {
      totalClaims: 0,
      supported: 0,
      unsupported: 0,
      needsResearch: 0,
      unsupportedClaimRate: 0,
    };
  }

  let supported = 0;
  let unsupported = 0;
  let needsResearch = 0;

  for (const check of claimChecks) {
    if (check.status === 'supported') supported++;
    else if (check.status === 'unsupported') unsupported++;
    else if (check.status === 'needs_more_research') needsResearch++;
  }

  // Unsupported claim rate includes both strictly unsupported and unverified needs_more_research
  const ungrounded = unsupported + needsResearch;
  const unsupportedClaimRate = Math.round((ungrounded / total) * 1000) / 10;

  return {
    totalClaims: total,
    supported,
    unsupported,
    needsResearch,
    unsupportedClaimRate,
  };
}

/**
 * Aggregates all metrics into a unified RunMetrics object.
 */
export function computeRunMetrics(params: {
  draft: string;
  claimChecks: ClaimCheck[];
  revisionCycles: number;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
}): RunMetrics {
  const sentenceStats = calculateCitationCoverage(params.draft);
  const claimStats = calculateClaimStats(params.claimChecks);

  // If there are no citation markers at all in the entire draft (e.g. Baseline A),
  // but sentences exist, every factual sentence is unverified.
  let unsupportedClaimRate = claimStats.unsupportedClaimRate;
  if (claimStats.totalClaims === 0 && sentenceStats.totalSentences > 0) {
    unsupportedClaimRate = 100.0;
  }

  return {
    totalClaims: claimStats.totalClaims,
    supportedClaims: claimStats.supported,
    unsupportedClaims: claimStats.unsupported,
    needsResearchClaims: claimStats.needsResearch,
    unsupportedClaimRate,
    citationCoverage: sentenceStats.coveragePercent,
    revisionCycles: params.revisionCycles,
    tokensUsed: params.tokensUsed,
    costUsd: Math.round(params.costUsd * 100000) / 100000,
    latencyMs: Math.round(params.latencyMs),
  };
}
