import { z } from 'zod';
import { NoteSchema, Note } from '@citewriter/core';

export const TopicRubricSchema = z.object({
  mustInclude: z.array(z.string()).min(1),
  expectedCitations: z.array(z.string()).min(1),
  unsupportedClaimRisks: z.array(z.string()).min(1),
});

export type TopicRubric = z.infer<typeof TopicRubricSchema>;

export const TopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  category: z.string().min(1),
  prompt: z.string().min(5),
  config: z
    .object({
      audience: z.string().default('software engineers'),
      tone: z.string().default('technical and precise'),
      targetWords: z.number().int().positive().default(500),
      format: z.enum(['article', 'linkedin_post', 'twitter_thread']).default('article'),
    })
    .default(() => ({
      audience: 'software engineers',
      tone: 'technical and precise',
      targetWords: 500,
      format: 'article' as const,
    })),
  rubric: TopicRubricSchema,
  mockNotes: z.array(NoteSchema).optional(),
});

export type Topic = z.infer<typeof TopicSchema>;

export interface RunMetrics {
  totalClaims: number;
  supportedClaims: number;
  unsupportedClaims: number;
  needsResearchClaims: number;
  unsupportedClaimRate: number; // percentage 0-100
  citationCoverage: number; // percentage 0-100
  revisionCycles: number;
  tokensUsed: number;
  costUsd: number;
  latencyMs: number;
}

export type VariantName = 'baseline_a' | 'baseline_b' | 'citewriter_pipeline';

export interface VariantEvalResult {
  variant: VariantName;
  variantLabel: string;
  topicId: string;
  topicTitle: string;
  draft: string;
  notes: Note[];
  metrics: RunMetrics;
  claimChecksSummary: {
    supported: number;
    unsupported: number;
    needsResearch: number;
  };
}

export interface TopicEvalComparison {
  topicId: string;
  topicTitle: string;
  category: string;
  baselineA: VariantEvalResult;
  baselineB: VariantEvalResult;
  pipeline: VariantEvalResult;
}

export interface EvalSuiteSummary {
  timestamp: string;
  totalTopics: number;
  averages: Record<
    VariantName,
    {
      label: string;
      avgUnsupportedClaimRate: number;
      avgCitationCoverage: number;
      avgRevisionCycles: number;
      avgCostUsd: number;
      avgTokens: number;
      avgLatencyMs: number;
    }
  >;
  results: TopicEvalComparison[];
}
