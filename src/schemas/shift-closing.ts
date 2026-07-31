import { z } from 'zod';

export const createShiftClosingSchema = z.object({
  counterId: z.number().int().positive().optional(),
  shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().optional(),
  submittedCash: z.number().nonnegative(),
  submittedBkash: z.number().nonnegative().optional().default(0),
  submittedNagad: z.number().nonnegative().optional().default(0),
  submittedCard: z.number().nonnegative().optional().default(0),
  submittedBank: z.number().nonnegative().optional().default(0),
  notes: z.string().trim().max(500).optional(),
});

export const approveShiftClosingSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().trim().max(500).optional(),
}).refine(
  (data) => data.action !== 'reject' || (data.notes && data.notes.trim().length > 0),
  { message: 'Notes required for rejection', path: ['notes'] }
);

export type CreateShiftClosingInput = z.infer<typeof createShiftClosingSchema>;
export type ApproveShiftClosingInput = z.infer<typeof approveShiftClosingSchema>;
