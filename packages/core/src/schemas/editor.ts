import { z } from 'zod';

export const EditorDecisionSchema = z.enum(['accept', 'revise']);

export type EditorDecision = z.infer<typeof EditorDecisionSchema>;

export const EditorVerdictSchema = z.object({
  score: z.number().min(0).max(10, 'Score must be between 0 and 10'),
  feedback: z.string().min(1, 'Feedback must not be empty'),
  decision: EditorDecisionSchema,
});

export type EditorVerdict = z.infer<typeof EditorVerdictSchema>;
