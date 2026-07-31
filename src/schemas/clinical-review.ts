import { z } from 'zod';

export const clinicalReviewSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  notes: z.string().trim().max(500).optional(),
}).superRefine((input, ctx) => {
  if (input.status === 'rejected' && !input.notes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['notes'],
      message: 'Review note required when rejecting a record',
    });
  }
});

export type ClinicalReviewInput = z.infer<typeof clinicalReviewSchema>;
