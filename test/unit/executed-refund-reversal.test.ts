import { describe, expect, it } from 'vitest';
import { reverseExecutedRefund } from '../../src/lib/executed-refund';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';

function setup(options: { sessionStatus?: 'active' | 'closed' } = {}) {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      status TEXT NOT NULL,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_notes TEXT,
      execution_status TEXT NOT NULL,
      request_data TEXT NOT NULL
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      due REAL NOT NULL,
      status TEXT NOT NULL,
      test_bill REAL NOT NULL,
      doctor_visit_bill REAL NOT NULL,
      admission_bill REAL NOT NULL,
      operation_bill REAL NOT NULL,
      medicine_bill REAL NOT NULL
    );
    CREATE TABLE billing_credit_notes (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      credit_note_no TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      total_amount REAL NOT NULL,
      refund_amount REAL NOT NULL,
      status TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      remarks TEXT,
      approved_by INTEGER,
      approved_at TEXT
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      credit_note_id INTEGER,
      idempotency_key TEXT NOT NULL,
      held_at TEXT,
      consumed_at TEXT,
      released_at TEXT,
      custody_user_id INTEGER,
      release_status TEXT DEFAULT 'not_applicable',
      release_counter_session_id INTEGER,
      release_cash_movement_id INTEGER,
      release_credited_at TEXT,
      resolved_by INTEGER,
      resolution_reason TEXT,
      updated_at TEXT
    );
    CREATE TABLE billing_refund_cash_disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      refund_cash_hold_id INTEGER NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      requester_user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      rejection_reason TEXT NOT NULL,
      rejected_by INTEGER NOT NULL,
      rejected_at TEXT,
      custody_user_id INTEGER,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      dispute_cash_movement_id INTEGER,
      settlement_method TEXT,
      settlement_reference_type TEXT,
      settlement_reference_id INTEGER,
      settlement_idempotency_key TEXT,
      settled_by INTEGER,
      settled_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (tenant_id, refund_cash_hold_id),
      UNIQUE (tenant_id, settlement_idempotency_key)
    );
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      variance_approval_status TEXT
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      description TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_by INTEGER,
      created_at TEXT,
      UNIQUE (tenant_id, reference_type, reference_id, movement_type)
    );
    CREATE TABLE accounting_account_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      mapping_key TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      UNIQUE (tenant_id, source_event_key)
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      commission_base_amount REAL NOT NULL,
      earned_commission_amount REAL NOT NULL,
      doctor_waiver_amount REAL NOT NULL,
      payable_commission_amount REAL NOT NULL,
      commission_amount REAL NOT NULL,
      paid_amount REAL NOT NULL,
      balance_amount REAL NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      updated_at TEXT
    );
    CREATE TABLE billing_refund_batch_guard (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      step_key TEXT NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      created_at TEXT,
      PRIMARY KEY (tenant_id, operation_key, step_key)
    );
    INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active) VALUES
      ('tenant-1', 'cash', 1, 1),
      ('tenant-1', 'accounts_receivable', 2, 1),
      ('tenant-1', 'employee_dispute_receivable', 3, 1),
      ('tenant-1', 'lab_revenue', 4, 1),
      ('tenant-1', 'other_revenue', 5, 1);
  `);

  const requestData = {
    executionMode: 'executed_pending',
    financialState: 'refunded_pending_review',
    cashHoldStatus: 'consumed',
    requestedRefundAmount: 400,
    cashRefundAmount: 400,
    receivableReduction: 0,
    counterId: 7,
    counterSessionId: 17,
    creditNoteNo: 'CN-000055',
    originalBill: {
      total: 1000,
      paid: 1000,
      due: 0,
      status: 'paid',
      testBill: 1000,
      doctorVisitBill: 0,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    },
    refundedBill: {
      total: 600,
      paid: 600,
      due: 0,
      status: 'paid',
      testBill: 600,
      doctorVisitBill: 0,
      admissionBill: 0,
      operationBill: 0,
      medicineBill: 0,
    },
    commissionImpactRows: [{
      accrualId: 91,
      billId: 75,
      oldCommissionBaseAmount: 1000,
      oldEarnedCommissionAmount: 200,
      oldDoctorWaiverAmount: 20,
      oldPayableCommissionAmount: 180,
      oldBalanceAmount: 180,
      newCommissionBaseAmount: 600,
      newEarnedCommissionAmount: 120,
      newDoctorWaiverAmount: 20,
      newPayableCommissionAmount: 100,
      newBalanceAmount: 100,
      paidAmount: 0,
      reversalAmount: 80,
    }],
  };
  harness.sqlite.prepare(`
    INSERT INTO approval_requests (
      id, tenant_id, type, entity_id, requested_by, status, execution_status, request_data
    ) VALUES (55, 'tenant-1', 'refund', 75, 3, 'pending', 'succeeded', ?)
  `).run(JSON.stringify(requestData));
  harness.sqlite.exec(`
    INSERT INTO bills VALUES (75, 'tenant-1', 600, 600, 0, 'paid', 600, 0, 0, 0, 0);
    INSERT INTO billing_credit_notes VALUES (
      8, 'tenant-1', 'CN-000055', 75, 400, 400, 'approved', 1, NULL, 3, '2026-07-26 10:00:00'
    );
    INSERT INTO billing_refund_cash_holds (
      id, tenant_id, approval_request_id, bill_id, patient_id, amount,
      payment_method, employee_id, counter_id, counter_session_id, status,
      credit_note_id, idempotency_key, consumed_at, release_status
    ) VALUES (
      9, 'tenant-1', 55, 75, 50, 400,
      'cash', 3, 7, 17, 'consumed',
      8, 'refund-request-55', '2026-07-26 10:00:00', 'not_applicable'
    );
    INSERT INTO billing_counter_sessions VALUES (
      17, 'tenant-1', 7, 3, '${options.sessionStatus ?? 'active'}', NULL
    );
    INSERT INTO doctor_commission_accruals VALUES (
      91, 'tenant-1', 75, 600, 120, 20, 100, 100, 0, 100, 'accrued', 'refunded', NULL
    );
  `);
  const request = harness.sqlite.prepare(`SELECT * FROM approval_requests WHERE id = 55`).get() as Record<string, unknown>;
  return { ...harness, request };
}

describe('reverseExecutedRefund', () => {
  it('restores legacy finance and opens a dispute without a second cash movement', async () => {
    const harness = setup();
    const result = await reverseExecutedRefund({
      db: harness.db,
      tenantId: 'tenant-1',
      request: harness.request,
      reviewerId: 1,
      reason: 'Refund was not justified',
      idempotencyKey: 'refund-reject-55',
      reversedAtUtc: '2026-07-26T15:00:00.000Z',
      businessDate: '2026-07-26',
    });

    expect(result).toMatchObject({
      cashResolution: 'open_dispute',
      cashHoldStatus: 'disputed',
      disputeStatus: 'open',
      financialState: 'refund_reversed_disputed',
      executionMode: 'legacy',
    });
    expect(harness.sqlite.prepare(`
      SELECT total, paid, due, status, test_bill FROM bills WHERE id = 75
    `).get()).toEqual({ total: 1000, paid: 1000, due: 0, status: 'paid', test_bill: 1000 });
    expect(harness.sqlite.prepare(`
      SELECT status, is_active FROM billing_credit_notes WHERE id = 8
    `).get()).toEqual({ status: 'reversed', is_active: 0 });
    expect(harness.sqlite.prepare(`
      SELECT commission_base_amount, earned_commission_amount, doctor_waiver_amount,
             payable_commission_amount, balance_amount
      FROM doctor_commission_accruals WHERE id = 91
    `).get()).toEqual({
      commission_base_amount: 1000,
      earned_commission_amount: 200,
      doctor_waiver_amount: 20,
      payable_commission_amount: 180,
      balance_amount: 180,
    });
    expect(harness.sqlite.prepare(`SELECT status FROM billing_refund_cash_holds WHERE id = 9`).get())
      .toEqual({ status: 'disputed' });
    expect(harness.sqlite.prepare(`SELECT status, dispute_cash_movement_id FROM billing_refund_cash_disputes`).get())
      .toEqual({ status: 'open', dispute_cash_movement_id: null });
    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM cash_drawer_movements`).get())
      .toEqual({ count: 0 });
    expect(harness.sqlite.prepare(`SELECT status, execution_status FROM approval_requests WHERE id = 55`).get())
      .toEqual({ status: 'rejected', execution_status: 'succeeded' });
  });

  it('credits acknowledged returned cash once and does not open a dispute', async () => {
    const harness = setup();
    const result = await reverseExecutedRefund({
      db: harness.db,
      tenantId: 'tenant-1',
      request: harness.request,
      reviewerId: 1,
      reason: 'Cash returned and verified',
      cashResolution: 'cash_returned',
      cashReturnedAcknowledged: true,
      idempotencyKey: 'refund-reject-55',
      reversedAtUtc: '2026-07-26T15:00:00.000Z',
      businessDate: '2026-07-26',
    });

    expect(result).toMatchObject({
      cashResolution: 'cash_returned',
      cashHoldStatus: 'settled',
      disputeStatus: 'not_required',
      financialState: 'refund_reversed_cash_returned',
    });
    expect(harness.sqlite.prepare(`
      SELECT status, release_status, release_counter_session_id
      FROM billing_refund_cash_holds WHERE id = 9
    `).get()).toEqual({ status: 'settled', release_status: 'credited', release_counter_session_id: 17 });
    expect(harness.sqlite.prepare(`
      SELECT movement_type, amount, reference_type FROM cash_drawer_movements
    `).all()).toEqual([{
      movement_type: 'cash_in',
      amount: 400,
      reference_type: 'executed_refund_cash_return',
    }]);
    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM billing_refund_cash_disputes`).get())
      .toEqual({ count: 0 });
  });

  it('fails closed before mutation when returned cash has no eligible active source session', async () => {
    const harness = setup({ sessionStatus: 'closed' });
    await expect(reverseExecutedRefund({
      db: harness.db,
      tenantId: 'tenant-1',
      request: harness.request,
      reviewerId: 1,
      reason: 'Cash returned and verified',
      cashResolution: 'cash_returned',
      cashReturnedAcknowledged: true,
      idempotencyKey: 'refund-reject-55',
      reversedAtUtc: '2026-07-26T15:00:00.000Z',
      businessDate: '2026-07-26',
    })).rejects.toThrow(/eligible counter session/i);

    expect(harness.sqlite.prepare(`SELECT total FROM bills WHERE id = 75`).get()).toEqual({ total: 600 });
    expect(harness.sqlite.prepare(`SELECT status FROM approval_requests WHERE id = 55`).get()).toEqual({ status: 'pending' });
    expect(harness.sqlite.prepare(`SELECT status FROM billing_refund_cash_holds WHERE id = 9`).get()).toEqual({ status: 'consumed' });
  });
});
