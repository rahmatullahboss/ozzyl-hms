import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  applyRefundCommissionImpact,
  buildRefundCommissionReservationStatements,
  buildRestoreRefundCommissionReservationStatements,
  calculateCommissionRefundImpact,
  loadRefundCommissionReservationPreview,
  previewRefundCommissionImpact,
} from '../../src/lib/billing-refund-commission';

const percentInput = {
  commissionBaseAmount: 400,
  commissionRateBps: 2500,
  commissionFlatAmount: 0,
  earnedCommissionAmount: 100,
  doctorWaiverAmount: 0,
  payableCommissionAmount: 100,
  paidAmount: 0,
  allocatedRefundAmount: 48.48,
  itemRefundableBalance: 400,
};

function setup() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE doctors (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT);
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      bill_id INTEGER,
      lab_order_item_id INTEGER,
      canonical_source_key TEXT,
      source_type TEXT,
      gross_amount REAL,
      commission_base_amount REAL,
      commission_rate_bps INTEGER,
      commission_flat_amount REAL,
      commission_amount REAL,
      earned_commission_amount REAL,
      doctor_waiver_amount REAL,
      payable_commission_amount REAL,
      paid_amount REAL,
      balance_amount REAL,
      status TEXT,
      accrued_date TEXT,
      notes TEXT,
      updated_at TEXT
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
      created_by TEXT,
      UNIQUE (tenant_id, source_event_key)
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      request_data TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      idempotency_key TEXT NOT NULL
    );
    CREATE TABLE billing_refund_commission_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      refund_cash_hold_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      accrual_id INTEGER NOT NULL,
      invoice_item_id INTEGER,
      allocated_refund_amount REAL NOT NULL,
      commission_base_reduction REAL NOT NULL,
      reserved_commission_amount REAL NOT NULL,
      original_commission_base_amount REAL NOT NULL,
      original_earned_commission_amount REAL NOT NULL,
      original_doctor_waiver_amount REAL NOT NULL,
      original_payable_commission_amount REAL NOT NULL,
      original_balance_amount REAL NOT NULL,
      reserved_commission_base_amount REAL NOT NULL,
      reserved_earned_commission_amount REAL NOT NULL,
      reserved_doctor_waiver_amount REAL NOT NULL,
      reserved_payable_commission_amount REAL NOT NULL,
      reserved_balance_amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_by INTEGER,
      resolved_by INTEGER,
      resolution_reason TEXT,
      created_at TEXT,
      updated_at TEXT,
      resolved_at TEXT,
      UNIQUE (tenant_id, approval_request_id, accrual_id)
    );
    CREATE TABLE billing_refund_batch_guard (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      step_key TEXT NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      created_at TEXT,
      PRIMARY KEY (tenant_id, operation_key, step_key)
    );
    CREATE TABLE canonical_financial_batch_assertions (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      step_key TEXT NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      PRIMARY KEY (tenant_id, operation_key, step_key)
    );
    CREATE TABLE canonical_outbox_events (
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_public_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      business_date TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tenant_id, event_public_id),
      UNIQUE (tenant_id, idempotency_key)
    );
    INSERT INTO doctors VALUES (130, 'tenant-1', 'Dr. Example Three');
    INSERT INTO doctor_commission_accruals VALUES
      (2622, 'tenant-1', 130, 50, NULL, 6907, NULL,
       'bill:6907:line:1:test:353:doctor:130:rule:21:prescribing',
       'lab_test', 400, 400, 2500, 0, 100, 100, 0, 100, 0, 100, 'accrued', '2026-07-22', NULL, NULL),
      (2623, 'tenant-1', 130, 50, NULL, 6907, NULL,
       'bill:6907:line:2:test:244:doctor:130:rule:21:prescribing',
       'lab_test', 500, 500, 2500, 0, 125, 125, 0, 125, 0, 125, 'accrued', '2026-07-22', NULL, NULL);
  `);
  return harness;
}

describe('refund commission reconciliation', () => {
  it('reduces percentage commission from the remaining eligible base', () => {
    expect(calculateCommissionRefundImpact(percentInput)).toEqual({
      newCommissionBaseAmount: 351.52,
      newEarnedCommissionAmount: 87.88,
      newDoctorWaiverAmount: 0,
      newPayableCommissionAmount: 87.88,
      newBalanceAmount: 87.88,
      reversalAmount: 12.12,
      blockedReason: null,
    });
  });

  it('reserves exactly 25 percent of a 400 proportional refund after line rounding', () => {
    const rows = [
      calculateCommissionRefundImpact({ ...percentInput, allocatedRefundAmount: 48.48 }),
      calculateCommissionRefundImpact({
        ...percentInput,
        commissionBaseAmount: 500,
        earnedCommissionAmount: 125,
        payableCommissionAmount: 125,
        allocatedRefundAmount: 60.61,
        itemRefundableBalance: 500,
      }),
      calculateCommissionRefundImpact({
        ...percentInput,
        commissionBaseAmount: 1200,
        earnedCommissionAmount: 300,
        payableCommissionAmount: 300,
        allocatedRefundAmount: 145.46,
        itemRefundableBalance: 1200,
      }),
      calculateCommissionRefundImpact({
        ...percentInput,
        commissionBaseAmount: 1200,
        earnedCommissionAmount: 300,
        payableCommissionAmount: 300,
        allocatedRefundAmount: 145.45,
        itemRefundableBalance: 1200,
      }),
    ];

    expect(rows.map((row) => row.reversalAmount)).toEqual([12.12, 15.15, 36.37, 36.36]);
    expect(rows.reduce((sum, row) => sum + row.reversalAmount, 0)).toBe(100);
    expect(rows.reduce((sum, row) => sum + row.newPayableCommissionAmount, 0)).toBe(725);
  });

  it('reduces flat commission proportionally to the refunded item value', () => {
    expect(calculateCommissionRefundImpact({
      ...percentInput,
      commissionBaseAmount: 500,
      commissionRateBps: 0,
      commissionFlatAmount: 100,
      earnedCommissionAmount: 100,
      payableCommissionAmount: 100,
      allocatedRefundAmount: 125,
      itemRefundableBalance: 500,
    })).toMatchObject({
      newCommissionBaseAmount: 375,
      newEarnedCommissionAmount: 75,
      newPayableCommissionAmount: 75,
      reversalAmount: 25,
    });
  });

  it('blocks when paid commission exceeds the recomputed payable amount', () => {
    expect(calculateCommissionRefundImpact({ ...percentInput, paidAmount: 95 })).toMatchObject({
      blockedReason: expect.stringMatching(/already paid/i),
    });
  });

  it('previews and applies item-linked commission reductions idempotently', async () => {
    const harness = setup();
    const allocations = [
      {
        invoiceItemId: 3058,
        description: 'ECG',
        itemCategory: 'test',
        lineAmount: 400,
        approvedCreditAmount: 0,
        pendingAllocatedAmount: 0,
        refundableBalance: 400,
        referenceId: 353,
        lineIndex: 1,
        allocatedRefundAmount: 48.48,
        allocationSource: 'auto' as const,
      },
      {
        invoiceItemId: 3059,
        description: 'S. Creatinine',
        itemCategory: 'test',
        lineAmount: 500,
        approvedCreditAmount: 0,
        pendingAllocatedAmount: 0,
        refundableBalance: 500,
        referenceId: 244,
        lineIndex: 2,
        allocatedRefundAmount: 60.61,
        allocationSource: 'auto' as const,
      },
    ];

    const preview = await previewRefundCommissionImpact(harness.db, {
      tenantId: 'tenant-1',
      billId: 6907,
      allocations,
    });
    expect(preview.rows).toEqual([
      expect.objectContaining({ accrualId: 2622, doctorName: 'Dr. Example Three', reversalAmount: 12.12 }),
      expect.objectContaining({ accrualId: 2623, doctorName: 'Dr. Example Three', reversalAmount: 15.15 }),
    ]);
    expect(preview.totalReversal).toBe(27.27);
    expect(preview.blocked).toBe(false);

    const commandInput = {
      tenantId: 'tenant-1',
      billId: 6907,
      allocations,
      creditNoteId: 44,
      creditNoteNo: 'CN-000044',
      userId: 1,
      eventDate: '2026-07-22',
      reason: 'Approved partial refund',
    } as const;
    const applied = await applyRefundCommissionImpact(harness.db, commandInput);
    const replay = await applyRefundCommissionImpact(harness.db, commandInput);

    expect(applied.totalReversal).toBe(27.27);
    expect(replay).toMatchObject({ rows: [], totalReversal: 27.27, blocked: false });
    await expect(applyRefundCommissionImpact(harness.db, {
      ...commandInput,
      userId: 2,
    })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

    expect(harness.sqlite.prepare('SELECT payable_commission_amount, balance_amount FROM doctor_commission_accruals WHERE id = 2622').get()).toEqual({
      payable_commission_amount: 87.88,
      balance_amount: 87.88,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM accounting_posting_events WHERE event_type = 'commission_cancelled'").get()).toEqual({ count: 2 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM billing_refund_batch_guard').get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_financial_batch_assertions').get()).toEqual({ count: 0 });
    const outbox = harness.sqlite.prepare(`
      SELECT payload_json
      FROM canonical_outbox_events
      WHERE tenant_id = 'tenant-1' AND idempotency_key = 'refund-commission-impact:CN-000044'
    `).get() as { payload_json: string };
    expect(outbox.payload_json).not.toContain('Dr. Example Three');
    expect(outbox.payload_json).not.toContain('ECG');
    expect(outbox.payload_json).toMatch(/"sourceEvidenceSha256":"[a-f0-9]{64}"/);
  });

  it('reserves commission with the refund hold and restores it after disputed cash recovery', async () => {
    const harness = setup();
    const allocations = [
      {
        invoiceItemId: 3058,
        description: 'ECG',
        itemCategory: 'test',
        lineAmount: 400,
        approvedCreditAmount: 0,
        pendingAllocatedAmount: 0,
        refundableBalance: 400,
        referenceId: 353,
        lineIndex: 1,
        allocatedRefundAmount: 48.48,
        allocationSource: 'auto' as const,
      },
      {
        invoiceItemId: 3059,
        description: 'S. Creatinine',
        itemCategory: 'test',
        lineAmount: 500,
        approvedCreditAmount: 0,
        pendingAllocatedAmount: 0,
        refundableBalance: 500,
        referenceId: 244,
        lineIndex: 2,
        allocatedRefundAmount: 60.61,
        allocationSource: 'auto' as const,
      },
    ];
    const preview = await previewRefundCommissionImpact(harness.db, {
      tenantId: 'tenant-1',
      billId: 6907,
      allocations,
    });
    harness.sqlite.prepare(`
      INSERT INTO approval_requests (id, tenant_id, type, request_data, status)
      VALUES (55, 'tenant-1', 'refund', '{"refundRequestIdempotencyKey":"refund-key-55"}', 'pending')
    `).run();
    harness.sqlite.prepare(`
      INSERT INTO billing_refund_cash_holds
        (id, tenant_id, approval_request_id, bill_id, amount, status, idempotency_key)
      VALUES (9, 'tenant-1', 55, 6907, 109.09, 'held', 'refund-key-55')
    `).run();

    const reserveStatements = await buildRefundCommissionReservationStatements(harness.db, {
      tenantId: 'tenant-1',
      billId: 6907,
      approvalRequestId: 55,
      refundCashHoldId: 9,
      userId: 3,
      eventDate: '2026-07-22',
      reason: 'Pending refund hold',
    }, preview);
    await harness.db.batch(reserveStatements);

    expect(await loadRefundCommissionReservationPreview(harness.db, 'tenant-1', 55)).toMatchObject({
      totalReversal: 27.27,
      status: 'held',
    });
    expect(harness.sqlite.prepare(`
      SELECT ROUND(SUM(payable_commission_amount), 2) AS payable
      FROM doctor_commission_accruals
      WHERE bill_id = 6907
    `).get()).toEqual({ payable: 197.73 });

    harness.sqlite.prepare(`
      UPDATE billing_refund_commission_reservations
      SET status = 'disputed'
      WHERE tenant_id = 'tenant-1' AND approval_request_id = 55
    `).run();
    const restoreStatements = await buildRestoreRefundCommissionReservationStatements(harness.db, {
      tenantId: 'tenant-1',
      approvalRequestId: 55,
      userId: 4,
      eventDate: '2026-07-22',
      reason: 'Disputed cash recovered',
    });
    await harness.db.batch(restoreStatements);

    expect(harness.sqlite.prepare(`
      SELECT ROUND(SUM(payable_commission_amount), 2) AS payable
      FROM doctor_commission_accruals
      WHERE bill_id = 6907
    `).get()).toEqual({ payable: 225 });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM billing_refund_commission_reservations
      WHERE approval_request_id = 55 AND status = 'released'
    `).get()).toEqual({ count: 2 });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM accounting_posting_events
      WHERE event_type = 'commission_accrued'
    `).get()).toEqual({ count: 2 });
  });
});
