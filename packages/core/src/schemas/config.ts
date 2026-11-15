import { z } from 'zod';

export const ContentFormatSchema = z.enum([
  'article',
  'linkedin_post',
  'twitter_thread',
]);

export type ContentFormat = z.infer<typeof ContentFormatSchema>;

export const RunConfigSchema = z.object({
  audience: z.string().min(1).default('software engineers'),
  tone: z.string().min(1).default('technical and precise'),
  targetWords: z.number().int().positive().default(500),
  format: ContentFormatSchema.default('article'),
  maxTokens: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
});

export type RunConfig = {
  audience: string;
  tone: string;
  targetWords: number;
  format?: ContentFormat;
  maxTokens?: number;
  maxCostUsd?: number;
};
