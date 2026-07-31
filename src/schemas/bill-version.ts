import { z } from 'zod';

export const billVersionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type BillVersionQueryInput = z.infer<typeof billVersionQuerySchema>;
