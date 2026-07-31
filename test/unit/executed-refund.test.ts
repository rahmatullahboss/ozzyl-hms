import { describe, expect, it } from 'vitest';
import {
  buildExecutedRefundRequestData,
  isExecutedPendingApproval,
  loadEligibleExecutedRefundCashReturnSessions,
  resolveExecutedRefundRejection,
} from '../../src/lib/executed-refund';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';

describe('executed refund workflow helpers', () => {
  it('stores immutable executed-pending financial and approval state', () => {
    const result = buildExecutedRefundRequestData({
      requestData: {
        refundKind: 'item_partial_refund',
        reason: 'Service was not performed',
        items: [{ invoiceItemId: 101, returnQuantity: 1 }],
      },
      refundRequestIdempotencyKey: 'refund-request-75-12345678',
      refundRequestHash: 'hash-1',
      totalRefund: 800,
      cashRefund: 800,
      receivableReduction: 0,
      counterId: 7,
      counterSessionId: 17,
      creditNoteNo: 'CN-000055',
      originalBill: {
        total: 2000,
        paid: 2000,
        due: 0,
        status: 'paid',
        testBill: 2000,
        doctorVisitBill: 0,
        admissionBill: 0,
        operationBill: 0,
        medicineBill: 0,
      },
      refundedBill: {
        total: 1200,
        paid: 1200,
        due: 0,
        status: 'paid',
        testBill: 1200,
        doctorVisitBill: 0,
        admissionBill: 0,
        operationBill: 0,
        medicineBill: 0,
      },
    });

    expect(result).toMatchObject({
      executionMode: 'executed_pending',
      financialState: 'refunded_pending_review',
      cashHoldStatus: 'consumed',
      approvalRevision: 1,
      requestedRefundAmount: 800,
      cashRefundAmount: 800,
      receivableReduction: 0,
      counterId: 7,
      counterSessionId: 17,
      creditNoteNo: 'CN-000055',
      refundRequestIdempotencyKey: 'refund-request-75-12345678',
      refundRequestHash: 'hash-1',
      originalBill: { total: 2000, paid: 2000, due: 0, status: 'paid' },
      refundedBill: { total: 1200, paid: 1200, due: 0, status: 'paid' },
    });
  });

  it('recognizes both executed refunds and payment voids as review-only approvals', () => {
    expect(isExecutedPendingApproval({
      type: 'refund',
      execution_status: 'succeeded',
      request_data: JSON.stringify({ executionMode: 'executed_pending' }),
    })).toBe(true);
    expect(isExecutedPendingApproval({
      type: 'payment_void',
      execution_status: 'succeeded',
      request_data: { executionMode: 'executed_pending' },
    })).toBe(true);
    expect(isExecutedPendingApproval({
      type: 'refund',
      execution_status: 'pending',
      request_data: { executionMode: 'executed_pending' },
    })).toBe(false);
    expect(isExecutedPendingApproval({
      type: 'refund',
      execution_status: 'succeeded',
      request_data: { executionMode: 'held_pending' },
    })).toBe(false);
  });

  it('returns only exact active original counter sessions as cash-return eligible', async () => {
    const harness = createSqliteD1Harness();
    harness.sqlite.exec(`
      CREATE TABLE billing_counter_sessions (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        counter_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        variance_approval_status TEXT
      );
      INSERT INTO billing_counter_sessions VALUES
        (17, 'tenant-1', 3, 77, 'active', 'approved'),
        (18, 'tenant-1', 3, 77, 'closed', 'approved'),
        (19, 'tenant-1', 3, 77, 'active', 'pending');
    `);

    const eligible = await loadEligibleExecutedRefundCashReturnSessions(harness.db, 'tenant-1', [
      { counterSessionId: 17, counterId: 3, employeeId: 77 },
      { counterSessionId: 18, counterId: 3, employeeId: 77 },
      { counterSessionId: 19, counterId: 3, employeeId: 77 },
      { counterSessionId: 17, counterId: 3, employeeId: 88 },
    ]);

    expect([...eligible.entries()]).toEqual([[17, { counterId: 3, employeeId: 77 }]]);
  });

  it('defaults rejected executed refunds to dispute and requires a stable idempotency key', () => {
    expect(resolveExecutedRefundRejection({
      idempotencyKey: 'refund-reject-83',
    })).toEqual({
      cashResolution: 'open_dispute',
      cashReturnedAcknowledged: false,
      idempotencyKey: 'refund-reject-83',
    });
    expect(() => resolveExecutedRefundRejection({ idempotencyKey: 'short' }))
      .toThrow(/idempotency/i);
  });

  it('requires explicit acknowledgement before treating physical cash as returned', () => {
    expect(() => resolveExecutedRefundRejection({
      cashResolution: 'cash_returned',
      idempotencyKey: 'refund-reject-83',
    })).toThrow(/acknowledgement/i);

    expect(resolveExecutedRefundRejection({
      cashResolution: 'cash_returned',
      cashReturnedAcknowledged: true,
      idempotencyKey: 'refund-reject-83',
    })).toEqual({
      cashResolution: 'cash_returned',
      cashReturnedAcknowledged: true,
      idempotencyKey: 'refund-reject-83',
    });
  });
});
