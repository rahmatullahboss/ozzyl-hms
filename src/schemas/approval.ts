import { z } from 'zod';

export const approvalTypeSchema = z.enum([
  'bill_edit',
  'bill_cancel',
  'bill_cancellation',
  'discount',
  'refund',
  'payment_void',
  'cash_handover',
  'expense',
  'stock_adjustment',
  'doctor_payout',
  'manual_adjustment',
  'credit_note',
  'credit_discharge',
  'receivable_write_off',
]);

export const approvalExecutionStatusSchema = z.enum(['not_required', 'pending', 'processing', 'succeeded', 'failed']);

const refundQuantityItemSchema = z.object({
  invoiceItemId: z.number().int().positive(),
  returnQuantity: z.number().int().positive(),
  description: z.string().trim().optional(),
  calculatedAmount: z.number().finite().nonnegative().optional(),
}).passthrough();

const refundAllocationItemSchema = z.object({
  invoiceItemId: z.number().int().positive(),
  allocatedRefundAmount: z.number().finite().nonnegative().refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'Allocated refund amount must have at most two decimal places',
  ),
  allocationSource: z.enum(['auto', 'requester_adjusted']).optional(),
}).passthrough();

const refundItemSchema = z.union([refundQuantityItemSchema, refundAllocationItemSchema]);

const approvalRequestDataSchema = z.object({
  oldValue: z.unknown().optional(),
  newValue: z.unknown().optional(),
  reason: z.string().trim().min(1, 'Reason is required').max(1000),
  refundKind: z.enum(['item_partial_refund', 'amount_partial_refund', 'bill_refund']).optional(),
  paymentMethod: z.string().trim().optional(),
  requestedRefundAmount: z.number().finite().min(0.01).refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'Refund amount must have at most two decimal places',
  ).optional(),
  items: z.array(refundItemSchema).optional(),
}).passthrough();

export const createApprovalRequestSchema = z.object({
  type: approvalTypeSchema,
  entityId: z.number().int().positive('Entity ID is required'),
  entityNo: z.string().trim().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  requestData: approvalRequestDataSchema,
}).superRefine((data, ctx) => {
  if (data.type === 'payment_void' && !data.idempotencyKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Idempotency key is required for payment void requests',
      path: ['idempotencyKey'],
    });
  }

  if (data.type !== 'refund' || !data.requestData.refundKind) return;

  if (!data.idempotencyKey) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Idempotency key is required for refund requests', path: ['idempotencyKey'] });
  }
  if (data.requestData.reason.trim().length < 3) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Refund reason must contain at least three characters', path: ['requestData', 'reason'] });
  }
  if (data.requestData.paymentMethod !== 'cash') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only cash refunds are supported in this workflow', path: ['requestData', 'paymentMethod'] });
  }

  if (data.requestData.refundKind === 'item_partial_refund') {
    if (!data.requestData.items || data.requestData.items.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select at least one refund item', path: ['requestData', 'items'] });
    } else if (data.requestData.items.some((item) => !('returnQuantity' in item))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Item refunds require a return quantity', path: ['requestData', 'items'] });
    }
  }
  if (data.requestData.refundKind === 'amount_partial_refund') {
    if (data.requestData.requestedRefundAmount === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Refund amount is required', path: ['requestData', 'requestedRefundAmount'] });
    }
    if (data.requestData.items?.some((item) => !('allocatedRefundAmount' in item))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Amount-based refund items require allocated refund amounts', path: ['requestData', 'items'] });
    }
  }

  const ids = (data.requestData.items ?? []).map((item) => item.invoiceItemId);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate refund items are not allowed', path: ['requestData', 'items'] });
  }
});

export const reviewApprovalSchema = z.object({
  action: z.enum(['approve', 'reject']),
  notes: z.string().trim().max(1000).optional(),
  cashResolution: z.enum(['cash_returned', 'open_dispute']).default('open_dispute'),
  cashReturnedAcknowledged: z.literal(true).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
}).superRefine((data, ctx) => {
  if (data.action === 'reject' && !data.notes?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Notes are required when rejecting',
      path: ['notes'],
    });
  }
  if (data.cashResolution === 'cash_returned' && data.cashReturnedAcknowledged !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Cash return acknowledgement is required',
      path: ['cashReturnedAcknowledged'],
    });
  }
});

export const requestInfoApprovalSchema = z.object({
  notes: z.string().trim().min(1, 'Information request note is required').max(1000),
  missingItems: z.array(z.string().trim().min(1)).max(20).optional(),
});

export const submitInfoApprovalSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
  missingItems: z.array(z.string().trim().min(1)).max(20).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  attachmentUrl: z.string().trim().max(1000).optional(),
  receiptUrl: z.string().trim().max(1000).optional(),
  documentUrl: z.string().trim().max(1000).optional(),
  evidenceUrl: z.string().trim().max(1000).optional(),
}).refine((data) => Boolean(
  data.notes?.trim()
    || data.attachmentUrl?.trim()
    || data.receiptUrl?.trim()
    || data.documentUrl?.trim()
    || data.evidenceUrl?.trim()
    || (data.evidence && Object.keys(data.evidence).length > 0)
), { message: 'Notes or evidence is required', path: ['notes'] });

const localDateOnlySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
      && parsed.getUTCMonth() === month - 1
      && parsed.getUTCDate() === day;
  }, 'Expected a valid calendar date');

export const approvalQuerySchema = z.object({
  type: approvalTypeSchema.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'all']).optional().default('pending'),
  executionStatus: approvalExecutionStatusSchema.optional(),
  queueFilter: z.enum(['high', 'sla_breached', 'due_soon', 'blocked', 'missing_evidence', 'info_requested']).optional(),
  reviewedDate: z.enum(['today']).optional(),
  createdFrom: localDateOnlySchema.optional(),
  createdTo: localDateOnlySchema.optional(),
  createdBefore: localDateOnlySchema.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(120).optional(),
}).superRefine((value, ctx) => {
  if (value.createdBefore && (value.createdFrom || value.createdTo)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['createdBefore'],
      message: 'createdBefore cannot be combined with createdFrom or createdTo',
    });
  }
  if (value.createdFrom && value.createdTo && value.createdFrom > value.createdTo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['createdTo'],
      message: 'createdTo must be on or after createdFrom',
    });
  }
});

/**
 * Bulk review schema — approve or reject up to 100 approvals at once.
 * Enforces separation of duties at the per-ID level is handled by the route.
 */
export const bulkReviewApprovalSchema = z.object({
  ids: z.array(z.number().int().positive())
    .min(1, 'At least one ID is required')
    .max(100, 'Cannot review more than 100 approvals at once'),
  action: z.enum(['approve', 'reject']),
  notes: z.string().trim().max(1000).optional(),
}).refine(
  (data) => data.action !== 'reject' || (data.notes && data.notes.trim().length > 0),
  { message: 'Notes are required when bulk rejecting', path: ['notes'] }
);

export type CreateApprovalRequestInput = z.infer<typeof createApprovalRequestSchema>;
export type ReviewApprovalInput = z.infer<typeof reviewApprovalSchema>;
export type RequestInfoApprovalInput = z.infer<typeof requestInfoApprovalSchema>;
export type SubmitInfoApprovalInput = z.infer<typeof submitInfoApprovalSchema>;
export type ApprovalQueryInput = z.infer<typeof approvalQuerySchema>;
export type BulkReviewApprovalInput = z.infer<typeof bulkReviewApprovalSchema>;
