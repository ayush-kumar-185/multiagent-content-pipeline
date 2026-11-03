import { z } from 'zod';

export const RunConfigSchema = z.object({
  audience: z.string().min(1).default('software engineers'),
  tone: z.string().min(1).default('technical and precise'),
  targetWords: z.number().int().positive().default(800),
  maxTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
});

export type RunConfig = z.infer<typeof RunConfigSchema>;
