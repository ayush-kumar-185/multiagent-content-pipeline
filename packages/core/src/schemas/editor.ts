import { z } from 'zod';

export const EditorDecisionSchema = z.enum(['accept', 'revise', 'reject']);
export type EditorDecision = z.infer<typeof EditorDecisionSchema>;

export const QualityScoresSchema = z.object({
  relevance: z.number().min(0).max(10),
  factualReliability: z.number().min(0).max(10),
  depth: z.number().min(0).max(10),
  originality: z.number().min(0).max(10),
  logicalFlow: z.number().min(0).max(10),
  engagement: z.number().min(0).max(10),
  readability: z.number().min(0).max(10),
  repetitionControl: z.number().min(0).max(10),
  conclusionQuality: z.number().min(0).max(10),
  // Explicit precision dimensions:
  evidenceToClaimPrecision: z.number().min(0).max(10).optional(),
  causalReasoning: z.number().min(0).max(10).optional(),
  numericalTraceability: z.number().min(0).max(10).optional(),
  industryClaimGroundedness: z.number().min(0).max(10).optional(),
  narrativeContinuity: z.number().min(0).max(10).optional(),
  redundantExplanations: z.number().min(0).max(10).optional(),
});

export type QualityScores = z.infer<typeof QualityScoresSchema>;

export const RevisionInstructionSchema = z.object({
  section: z.string(),
  issue: z.string(),
  action: z.string(),
});

export type RevisionInstruction = z.infer<typeof RevisionInstructionSchema>;

export const RepetitionFindingSchema = z.object({
  sectionIds: z.array(z.string()),
  repeatedIdea: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  recommendation: z.enum(['remove', 'merge', 'rewrite']),
});

export type RepetitionFinding = z.infer<typeof RepetitionFindingSchema>;

export const EditorVerdictSchema = z.object({
  score: z.number().min(0).max(10, 'Score must be between 0 and 10'),
  overallScore: z.number().min(0).max(10).optional(),
  scores: QualityScoresSchema.optional(),
  strengths: z.array(z.string()).optional(),
  weaknesses: z.array(z.string()).optional(),
  missingInformation: z.array(z.string()).optional(),
  redundantSections: z.array(z.string()).optional(),
  revisionInstructions: z.array(RevisionInstructionSchema).optional(),
  repetitionFindings: z.array(RepetitionFindingSchema).optional(),
  feedback: z.string().min(1, 'Feedback must not be empty'),
  decision: EditorDecisionSchema,
});

export type EditorVerdict = z.infer<typeof EditorVerdictSchema>;
