import { describe, it, expect } from 'vitest';
import {
  createApprovalRequestSchema,
  reviewApprovalSchema,
  approvalQuerySchema,
} from '../../src/schemas/approval';

describe('Approval Schemas', () => {
  describe('createApprovalRequestSchema', () => {
    it('accepts valid bill_edit request', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        entityNo: 'INV-001',
        requestData: {
          oldValue: { total: 5000 },
          newValue: { total: 6000 },
          reason: 'Price correction',
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid bill_cancel request', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_cancel',
        entityId: 100,
        requestData: { reason: 'Patient requested' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid discount request', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'discount',
        entityId: 50,
        requestData: { reason: 'VIP patient discount' },
      });
      expect(result.success).toBe(true);
    });

    it('accepts valid legacy refund request', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        requestData: { reason: 'Overpayment refund' },
      });
      expect(result.success).toBe(true);
    });

    it('requires an idempotency key for payment void requests', () => {
      const request = {
        type: 'payment_void' as const,
        entityId: 83,
        requestData: { reason: 'Wrongly marked as paid' },
      };

      expect(createApprovalRequestSchema.safeParse(request).success).toBe(false);
      expect(createApprovalRequestSchema.safeParse({
        ...request,
        idempotencyKey: 'payment-void-83-12345678',
      }).success).toBe(true);
    });

    it('accepts item-based refund requests with idempotency and cash payment', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        idempotencyKey: 'refund-request-75-12345678',
        requestData: {
          refundKind: 'item_partial_refund',
          paymentMethod: 'cash',
          reason: 'Tests were not performed',
          items: [{ invoiceItemId: 101, returnQuantity: 1 }],
        },
      });
      expect(result.success).toBe(true);
    });

    it('accepts amount-based partial refund requests without item returns', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        idempotencyKey: 'refund-request-75-amount-12345678',
        requestData: {
          refundKind: 'amount_partial_refund',
          paymentMethod: 'cash',
          requestedRefundAmount: 250.5,
          reason: 'Manual partial refund approved by management',
        },
      });

      expect(result.success).toBe(true);
    });

    it('rejects amount-based refunds with missing, invalid, or item-bearing amounts', () => {
      const baseRequest = {
        type: 'refund' as const,
        entityId: 75,
        idempotencyKey: 'refund-request-75-amount-12345678',
        requestData: {
          refundKind: 'amount_partial_refund' as const,
          paymentMethod: 'cash',
          reason: 'Manual partial refund approved by management',
        },
      };

      expect(createApprovalRequestSchema.safeParse(baseRequest).success).toBe(false);
      expect(createApprovalRequestSchema.safeParse({
        ...baseRequest,
        requestData: { ...baseRequest.requestData, requestedRefundAmount: 0 },
      }).success).toBe(false);
      expect(createApprovalRequestSchema.safeParse({
        ...baseRequest,
        requestData: { ...baseRequest.requestData, requestedRefundAmount: Number.POSITIVE_INFINITY },
      }).success).toBe(false);
      expect(createApprovalRequestSchema.safeParse({
        ...baseRequest,
        requestData: { ...baseRequest.requestData, requestedRefundAmount: 10.001 },
      }).success).toBe(false);
      expect(createApprovalRequestSchema.safeParse({
        ...baseRequest,
        requestData: {
          ...baseRequest.requestData,
          requestedRefundAmount: 250,
          items: [{ invoiceItemId: 101, returnQuantity: 1 }],
        },
      }).success).toBe(false);
    });

    it('rejects item-based refunds without items, cash mode, or idempotency', () => {
      expect(createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        requestData: {
          refundKind: 'item_partial_refund',
          paymentMethod: 'cash',
          reason: 'Tests were not performed',
          items: [],
        },
      }).success).toBe(false);

      expect(createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        idempotencyKey: 'refund-request-75-12345678',
        requestData: {
          refundKind: 'item_partial_refund',
          paymentMethod: 'card',
          reason: 'Tests were not performed',
          items: [{ invoiceItemId: 101, returnQuantity: 1 }],
        },
      }).success).toBe(false);
    });

    it('rejects structured refund reasons shorter than three characters', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        idempotencyKey: 'refund-request-75-short-reason',
        requestData: {
          refundKind: 'item_partial_refund',
          paymentMethod: 'cash',
          reason: 'no',
          items: [{ invoiceItemId: 101, returnQuantity: 1 }],
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects duplicate invoice items in a refund request', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'refund',
        entityId: 75,
        idempotencyKey: 'refund-request-75-12345678',
        requestData: {
          refundKind: 'item_partial_refund',
          paymentMethod: 'cash',
          reason: 'Tests were not performed',
          items: [
            { invoiceItemId: 101, returnQuantity: 1 },
            { invoiceItemId: 101, returnQuantity: 1 },
          ],
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid type', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'invalid_type',
        entityId: 100,
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing entityId', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects negative entityId', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: -1,
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects zero entityId', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 0,
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing reason', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: {},
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty reason', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: { reason: '' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects entityId as string', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 'abc',
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects entityId as null', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: null,
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects requestData as null', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: null,
      });
      expect(result.success).toBe(false);
    });

    it('rejects requestData as non-object', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects reason exceeding 1000 chars', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: { reason: 'a'.repeat(1001) },
      });
      expect(result.success).toBe(false);
    });

    it('accepts reason at exactly 1000 chars', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: { reason: 'a'.repeat(1000) },
      });
      expect(result.success).toBe(true);
    });

    it('accepts request without entityNo (optional)', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: { reason: 'test' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.entityNo).toBeUndefined();
      }
    });

    it('accepts request with oldValue and newValue of any shape', () => {
      const result = createApprovalRequestSchema.safeParse({
        type: 'bill_edit',
        entityId: 100,
        requestData: {
          oldValue: { items: [{ name: 'Test', qty: 1, price: 100 }] },
          newValue: { items: [{ name: 'Test', qty: 2, price: 100 }] },
          reason: 'Quantity change',
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('reviewApprovalSchema', () => {
    it('accepts approve without notes', () => {
      const result = reviewApprovalSchema.safeParse({ action: 'approve' });
      expect(result.success).toBe(true);
    });

    it('accepts approve with notes', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'approve',
        notes: 'Looks good',
      });
      expect(result.success).toBe(true);
    });

    it('accepts reject with notes', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'Incorrect information',
      });
      expect(result.success).toBe(true);
    });

    it('rejects reject without notes', () => {
      const result = reviewApprovalSchema.safeParse({ action: 'reject' });
      expect(result.success).toBe(false);
    });

    it('rejects reject with empty notes', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects reject with whitespace-only notes', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: '   ',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid action', () => {
      const result = reviewApprovalSchema.safeParse({ action: 'cancel' });
      expect(result.success).toBe(false);
    });

    it('rejects notes exceeding 1000 chars', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'a'.repeat(1001),
      });
      expect(result.success).toBe(false);
    });

    it('accepts notes at exactly 1000 chars for reviewApprovalSchema', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'a'.repeat(1000),
      });
      expect(result.success).toBe(true);
    });

    it('defaults refund rejection cash resolution to open_dispute', () => {
      const result = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'Refund evidence is invalid',
        idempotencyKey: 'refund-reject-83',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cashResolution).toBe('open_dispute');
      }
    });

    it('requires explicit acknowledgement for cash_returned', () => {
      const missing = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'Cash was returned',
        cashResolution: 'cash_returned',
        idempotencyKey: 'refund-reject-83',
      });
      expect(missing.success).toBe(false);

      const acknowledged = reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'Cash was returned',
        cashResolution: 'cash_returned',
        cashReturnedAcknowledged: true,
        idempotencyKey: 'refund-reject-83',
      });
      expect(acknowledged.success).toBe(true);
    });

    it('validates rejection idempotency key length when provided', () => {
      expect(reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'Invalid refund',
        idempotencyKey: 'short',
      }).success).toBe(false);
      expect(reviewApprovalSchema.safeParse({
        action: 'reject',
        notes: 'Invalid refund',
        idempotencyKey: 'x'.repeat(129),
      }).success).toBe(false);
    });
  });

  describe('approvalQuerySchema', () => {
    it('uses default values when no params provided', () => {
      const result = approvalQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.status).toBe('pending');
        expect(result.data.page).toBe(1);
        expect(result.data.limit).toBe(20);
        expect(result.data.type).toBeUndefined();
      }
    });

    it('accepts valid type filter', () => {
      const result = approvalQuerySchema.safeParse({ type: 'bill_edit' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('bill_edit');
      }
    });

    it('rejects invalid type filter', () => {
      const result = approvalQuerySchema.safeParse({ type: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('accepts all valid types', () => {
      for (const type of ['bill_edit', 'bill_cancel', 'discount', 'refund']) {
        const result = approvalQuerySchema.safeParse({ type });
        expect(result.success).toBe(true);
      }
    });

    it('accepts all valid statuses', () => {
      for (const status of ['pending', 'approved', 'rejected']) {
        const result = approvalQuerySchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid status', () => {
      const result = approvalQuerySchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('coerces string page/limit to numbers', () => {
      const result = approvalQuerySchema.safeParse({ page: '3', limit: '50' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.page).toBe(3);
        expect(result.data.limit).toBe(50);
      }
    });

    it('rejects page < 1', () => {
      const result = approvalQuerySchema.safeParse({ page: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects limit > 100', () => {
      const result = approvalQuerySchema.safeParse({ limit: 101 });
      expect(result.success).toBe(false);
    });

    it('accepts limit at exactly 100', () => {
      const result = approvalQuerySchema.safeParse({ limit: 100 });
      expect(result.success).toBe(true);
    });
  });
});
