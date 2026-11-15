import { describe, it, expect } from 'vitest';
import { calculateWeightedScore, evaluateHardGates, resolveEditorDecision } from './scoring.js';
import type { QualityScores } from '../../schemas/editor.js';

describe('Editor Scoring Engine', () => {
  const perfectScores: QualityScores = {
    factualReliability: 10,
    relevance: 10,
    depth: 10,
    logicalFlow: 10,
    originality: 10,
    engagement: 10,
    repetitionControl: 10,
    readability: 10,
    conclusionQuality: 10,
  };

  it('calculates weighted score correctly with all 10s', () => {
    const score = calculateWeightedScore(perfectScores);
    expect(score).toBe(10);
  });

  it('calculates weighted score according to exact specified weights', () => {
    // Weights: factualReliability 20%, relevance 15%, depth 15%, logicalFlow 10%,
    // originality 10%, engagement 10%, repetitionControl 10%, readability 5%, conclusionQuality 5%
    const mixedScores: QualityScores = {
      factualReliability: 8, // 8 * 0.20 = 1.6
      relevance: 7,          // 7 * 0.15 = 1.05
      depth: 6,              // 6 * 0.15 = 0.90
      logicalFlow: 8,        // 8 * 0.10 = 0.80
      originality: 7,        // 7 * 0.10 = 0.70
      engagement: 8,         // 8 * 0.10 = 0.80
      repetitionControl: 9,  // 9 * 0.10 = 0.90
      readability: 8,        // 8 * 0.05 = 0.40
      conclusionQuality: 7,  // 7 * 0.05 = 0.35
      // Total = 1.6 + 1.05 + 0.90 + 0.80 + 0.70 + 0.80 + 0.90 + 0.40 + 0.35 = 7.5
    };
    const score = calculateWeightedScore(mixedScores);
    expect(score).toBe(7.5);
  });

  it('enforces hard quality gate on factualReliability < 7', () => {
    const scores: QualityScores = {
      ...perfectScores,
      factualReliability: 6.5,
    };
    const gateResult = evaluateHardGates(scores);
    expect(gateResult.passed).toBe(false);
    expect(gateResult.failedGates.length).toBeGreaterThan(0);
    expect(gateResult.failedGates[0]!.toLowerCase()).toContain('factual reliability');
  });

  it('enforces hard quality gate on repetitionControl < 6', () => {
    const scores: QualityScores = {
      ...perfectScores,
      repetitionControl: 5.5,
    };
    const gateResult = evaluateHardGates(scores);
    expect(gateResult.passed).toBe(false);
    expect(gateResult.failedGates[0]!.toLowerCase()).toContain('repetition');
  });

  it('resolves decision to accept when overallScore >= 7.5 and gates pass', () => {
    const scores: QualityScores = {
      ...perfectScores,
      originality: 8,
      relevance: 8,
    };
    const decision = resolveEditorDecision(scores);
    expect(decision).toBe('accept');
  });

  it('resolves decision to revise when score < 7.5 even if gates pass', () => {
    const lowScores: QualityScores = {
      factualReliability: 7,
      relevance: 7,
      depth: 6,
      logicalFlow: 6,
      originality: 6,
      engagement: 6,
      repetitionControl: 6,
      readability: 6,
      conclusionQuality: 6,
    };
    const decision = resolveEditorDecision(lowScores);
    expect(decision).toBe('revise');
  });

  it('resolves decision to revise if any hard gate fails', () => {
    const scores: QualityScores = {
      ...perfectScores,
      factualReliability: 5, // Fails gate
    };
    const decision = resolveEditorDecision(scores);
    expect(decision).toBe('revise');
  });
});
