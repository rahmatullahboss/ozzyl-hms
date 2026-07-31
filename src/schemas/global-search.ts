import { z } from 'zod';

export const globalSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search query must be at least 2 characters').max(100),
  limit: z.coerce.number().int().min(1).max(20).optional().default(5),
});

export type GlobalSearchQueryInput = z.infer<typeof globalSearchQuerySchema>;
