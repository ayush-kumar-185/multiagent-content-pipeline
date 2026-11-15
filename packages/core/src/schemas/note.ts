import { z } from 'zod';

export const SourceTypeSchema = z.enum([
  'academic',
  'industry',
  'news',
  'official_documentation',
  'general',
]);

export type SourceType = z.infer<typeof SourceTypeSchema>;

export const NoteSchema = z.object({
  id: z.string().min(1, 'Note ID must not be empty'),
  claim: z.string().min(1, 'Claim must not be empty'),
  sourceUrl: z.string().url('Source URL must be a valid URL'),
  quote: z.string().min(1, 'Quote must not be empty'),
  retrievedAt: z.string().datetime({ message: 'retrievedAt must be a valid ISO 8601 string' }),
  sourceTitle: z.string().optional(),
  publisher: z.string().optional(),
  publishedAt: z.string().optional(),
  sourceType: SourceTypeSchema.optional(),
  researchCategory: z.string().optional(),
});

export type Note = z.infer<typeof NoteSchema>;
