import { z } from 'zod';

const idempotencyKeySchema = z.string().trim().min(8).max(160);

export const refundDisputeListQuerySchema = z.object({
  status: z.enum(['open', 'recovery_pending', 'recovered', 'writeoff_pending', 'written_off', 'all']).default('open'),
  requesterUserId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const recoverRefundDisputeSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  notes: z.string().trim().max(1000).optional(),
});

export const requestRefundDisputeWriteoffSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().min(3).max(1000),
  evidence: z.record(z.unknown()).optional(),
});

export type RefundDisputeListQuery = z.infer<typeof refundDisputeListQuerySchema>;
export type RecoverRefundDisputeInput = z.infer<typeof recoverRefundDisputeSchema>;
export type RequestRefundDisputeWriteoffInput = z.infer<typeof requestRefundDisputeWriteoffSchema>;
