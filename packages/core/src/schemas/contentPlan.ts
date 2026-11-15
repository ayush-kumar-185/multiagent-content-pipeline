import { z } from 'zod';

export const SectionPlanSchema = z.object({
  id: z.string(),
  heading: z.string(),
  keyPoint: z.string(),
  assignedNoteIds: z.array(z.string()),
  targetWords: z.number().int().positive().optional(),
});

export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const ContentPlanSchema = z.object({
  centralAngle: z.string().min(1, 'Central angle must not be empty'),
  intendedTakeaway: z.string().min(1, 'Intended takeaway must not be empty'),
  keyInsights: z.array(z.string()).min(1, 'At least one key insight required'),
  narrativeFlow: z.array(SectionPlanSchema).min(1, 'At least one section required'),
  redundantInformation: z.array(z.string()).optional().default([]),
  missingInformation: z.array(z.string()).optional().default([]),
  avoid: z.array(z.string()).optional().default([]),
});

export type ContentPlan = z.infer<typeof ContentPlanSchema>;
