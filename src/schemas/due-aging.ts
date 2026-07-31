import { z } from 'zod';

export const dueAgingQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  department: z.string().trim().optional(),
  patientId: z.coerce.number().int().positive().optional(),
});

export type DueAgingQueryInput = z.infer<typeof dueAgingQuerySchema>;
