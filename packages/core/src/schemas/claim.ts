import { z } from 'zod';

export const ClaimSchema = z.object({
  id: z.string().optional(),
  claim: z.string().min(1, 'Claim text must not be empty'),
  noteIds: z.array(z.string().min(1)).min(1, 'At least one note ID is required'),
});

export type Claim = z.infer<typeof ClaimSchema>;

export const ClaimCheckStatusSchema = z.enum(['supported', 'unsupported', 'needs_more_research']);

export type ClaimCheckStatus = z.infer<typeof ClaimCheckStatusSchema>;

export const ClaimCheckSchema = z.object({
  claim: z.string().min(1, 'Claim must not be empty'),
  noteIds: z.array(z.string().min(1)),
  status: ClaimCheckStatusSchema,
  reason: z.string(),
});

export type ClaimCheck = z.infer<typeof ClaimCheckSchema>;
