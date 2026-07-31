import { describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  prepareCreditReturnedExecutedRefundCash,
  prepareSettleExecutedRefundHold,
} from '../../src/lib/billing-refund-cash-hold';
import {
  completeRefundDisputeWriteoff,
  loadRefundCashDispute,
  markRefundDisputeWriteoffPending,
  prepareAttachRefundDisputeCashOut,
  prepareCreateExecutedRefundDispute,
  prepareCreateRefundDispute,
  prepareCreateRefundDisputeCashOut,
  prepareExecutedRefundDisputeOpenedAccountingEvent,
  prepareMarkExecutedRefundHoldDisputed,
  prepareMarkRefundHoldDisputed,
  prepareRefundDisputeOpenedAccountingEvent,
  recoverRefundDispute,
} from '../../src/lib/billing-refund-dispute';

function setup() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL,
      reviewed_by INTEGER,
      execution_status TEXT NOT NULL DEFAULT 'not_required',
      request_data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
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
    CREATE TABLE doctors (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      description TEXT
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doctor_id INTEGER NOT NULL,
      patient_id INTEGER,
      visit_id INTEGER,
      source_type TEXT,
      gross_amount REAL,
      paid_amount REAL,
      accrued_date TEXT
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
      resolved_at TEXT
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
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      variance_approval_status TEXT
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
    INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active) VALUES
      ('tenant-1', 'cash', 1, 1),
      ('tenant-1', 'employee_dispute_receivable', 2, 1),
      ('tenant-1', 'general_expense', 3, 1);
    INSERT INTO approval_requests (id, tenant_id, status, reviewed_by, execution_status, request_data)
    VALUES (55, 'tenant-1', 'rejected', 1, 'not_required', '{}');
    INSERT INTO billing_refund_cash_holds (
      id, tenant_id, approval_request_id, bill_id, patient_id, amount,
      employee_id, counter_id, counter_session_id, status, custody_user_id,
      release_status, release_counter_session_id, release_cash_movement_id,
      release_credited_at, resolved_by, resolution_reason, updated_at
    ) VALUES (
      9, 'tenant-1', 55, 75, 50, 400,
      3, 7, 17, 'held', NULL,
      'not_applicable', NULL, NULL,
      NULL, NULL, NULL, NULL
    );
    INSERT INTO billing_counter_sessions VALUES
      (17, 'tenant-1', 7, 3, 'active', NULL),
      (88, 'tenant-1', 9, 2, 'active', NULL);
  `);
  return harness;
}

async function openDispute() {
  const harness = setup();
  const common = {
    tenantId: 'tenant-1',
    holdId: 9,
    approvalRequestId: 55,
    billId: 75,
    requesterUserId: 3,
    amount: 400,
    requesterCounterId: 7,
    requesterCounterSessionId: 17,
    requesterEmployeeId: 3,
    custodyUserId: null,
    rejectedBy: 1,
    reason: 'Refund was not justified',
  };
  const accountingStatement = await prepareRefundDisputeOpenedAccountingEvent(harness.db, {
    ...common,
    eventDate: '2026-07-22',
  });
  await harness.db.batch([
    prepareCreateRefundDispute(harness.db, common),
    prepareCreateRefundDisputeCashOut(harness.db, common),
    prepareAttachRefundDisputeCashOut(harness.db, common),
    accountingStatement,
    prepareMarkRefundHoldDisputed(harness.db, common),
  ]);
  return harness;
}

describe('refund disputed cash lifecycle', () => {
  it('rejection marks the hold disputed and creates one requester liability', async () => {
    const harness = await openDispute();

    expect(harness.sqlite.prepare('SELECT status, resolved_by, resolution_reason FROM billing_refund_cash_holds WHERE id = 9').get()).toEqual({
      status: 'disputed',
      resolved_by: 1,
      resolution_reason: 'Refund was not justified',
    });
    expect(harness.sqlite.prepare('SELECT requester_user_id, amount, status, dispute_cash_movement_id FROM billing_refund_cash_disputes').get()).toMatchObject({
      requester_user_id: 3,
      amount: 400,
      status: 'open',
      dispute_cash_movement_id: 1,
    });
    expect(harness.sqlite.prepare('SELECT movement_type, amount, reference_type, reference_id FROM cash_drawer_movements').get()).toEqual({
      movement_type: 'cash_out',
      amount: 400,
      reference_type: 'refund_cash_dispute',
      reference_id: 9,
    });
    const openedEvent = harness.sqlite.prepare(`
      SELECT source_type, event_type, payload_json
      FROM accounting_posting_events
      WHERE source_type = 'refund_cash_dispute_opened'
    `).get() as { source_type: string; event_type: string; payload_json: string };
    expect(openedEvent).toMatchObject({
      source_type: 'refund_cash_dispute_opened',
      event_type: 'manual_journal',
    });
    expect(JSON.parse(openedEvent.payload_json)).toEqual({
      lines: [
        { accountId: 2, debit: 400, credit: 0, memo: 'Requester #3 refund dispute receivable' },
        { accountId: 1, debit: 0, credit: 400, memo: 'Rejected refund cash removed from counter #7' },
      ],
    });
  });

  it('opens an executed-refund dispute without creating a second cash-out', async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE approval_requests
      SET execution_status = 'succeeded'
      WHERE id = 55
    `).run();
    harness.sqlite.prepare(`
      UPDATE billing_refund_cash_holds
      SET status = 'consumed'
      WHERE id = 9
    `).run();
    const input = {
      tenantId: 'tenant-1',
      holdId: 9,
      approvalRequestId: 55,
      billId: 75,
      requesterUserId: 3,
      amount: 400,
      requesterCounterId: 7,
      requesterCounterSessionId: 17,
      requesterEmployeeId: 3,
      custodyUserId: null,
      rejectedBy: 1,
      reason: 'Executed refund was rejected',
    };
    const accountingStatement = await prepareExecutedRefundDisputeOpenedAccountingEvent(harness.db, {
      ...input,
      eventDate: '2026-07-26',
    });

    await harness.db.batch([
      prepareCreateExecutedRefundDispute(harness.db, input),
      accountingStatement,
      prepareMarkExecutedRefundHoldDisputed(harness.db, input),
    ]);

    expect(harness.sqlite.prepare(`
      SELECT status, resolved_by, resolution_reason
      FROM billing_refund_cash_holds WHERE id = 9
    `).get()).toEqual({
      status: 'disputed',
      resolved_by: 1,
      resolution_reason: 'Executed refund was rejected',
    });
    expect(harness.sqlite.prepare(`
      SELECT status, dispute_cash_movement_id
      FROM billing_refund_cash_disputes
    `).get()).toEqual({ status: 'open', dispute_cash_movement_id: null });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM cash_drawer_movements
    `).get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare(`
      SELECT source_type FROM accounting_posting_events
      WHERE source_type = 'executed_refund_cash_dispute_opened'
    `).get()).toEqual({ source_type: 'executed_refund_cash_dispute_opened' });
  });

  it('settles an executed refund with exactly one acknowledged cash return', async () => {
    const harness = setup();
    harness.sqlite.prepare(`
      UPDATE approval_requests
      SET execution_status = 'succeeded'
      WHERE id = 55
    `).run();
    harness.sqlite.prepare(`
      UPDATE billing_refund_cash_holds
      SET status = 'consumed'
      WHERE id = 9
    `).run();
    const input = {
      tenantId: 'tenant-1',
      holdId: 9,
      approvalRequestId: 55,
      amount: 400,
      reviewerId: 1,
      destination: {
        counterSessionId: 17,
        counterId: 7,
        employeeId: 3,
      },
      idempotencyKey: 'refund-reject-55',
      reason: 'Physical cash returned and verified',
    };

    await harness.db.batch([
      prepareCreditReturnedExecutedRefundCash(harness.db, input),
      prepareSettleExecutedRefundHold(harness.db, input),
    ]);
    await harness.db.batch([
      prepareCreditReturnedExecutedRefundCash(harness.db, input),
      prepareSettleExecutedRefundHold(harness.db, input),
    ]);

    expect(harness.sqlite.prepare(`
      SELECT status, release_status, release_counter_session_id,
             release_cash_movement_id, resolved_by
      FROM billing_refund_cash_holds WHERE id = 9
    `).get()).toEqual({
      status: 'settled',
      release_status: 'credited',
      release_counter_session_id: 17,
      release_cash_movement_id: 1,
      resolved_by: 1,
    });
    expect(harness.sqlite.prepare(`
      SELECT movement_type, amount, reference_type, reference_id
      FROM cash_drawer_movements
    `).all()).toEqual([{
      movement_type: 'cash_in',
      amount: 400,
      reference_type: 'executed_refund_cash_return',
      reference_id: 9,
    }]);
  });

  it('cash recovery posts cash-in and settles the dispute exactly once', async () => {
    const harness = await openDispute();
    const dispute = await loadRefundCashDispute(harness.db, 'tenant-1', 1);
    expect(dispute?.status).toBe('open');

    const recovered = await recoverRefundDispute(harness.db, {
      tenantId: 'tenant-1',
      disputeId: 1,
      destinationCounterSessionId: 88,
      destinationCounterId: 9,
      destinationEmployeeId: 2,
      recoveredBy: 1,
      idempotencyKey: 'recover-dispute-1',
      notes: 'Cash returned by requester',
    });
    const replay = await recoverRefundDispute(harness.db, {
      tenantId: 'tenant-1',
      disputeId: 1,
      destinationCounterSessionId: 88,
      destinationCounterId: 9,
      destinationEmployeeId: 2,
      recoveredBy: 1,
      idempotencyKey: 'recover-dispute-1',
      notes: 'Cash returned by requester',
    });

    expect(recovered.status).toBe('recovered');
    expect(replay.status).toBe('recovered');
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM cash_drawer_movements WHERE movement_type = 'cash_in'").get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare('SELECT status FROM billing_refund_cash_holds WHERE id = 9').get()).toEqual({ status: 'settled' });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_posting_events').get()).toEqual({ count: 2 });
    const recoveredEvent = harness.sqlite.prepare(`
      SELECT payload_json
      FROM accounting_posting_events
      WHERE source_type = 'refund_cash_dispute_recovered'
    `).get() as { payload_json: string };
    expect(JSON.parse(recoveredEvent.payload_json)).toEqual({
      lines: [
        { accountId: 1, debit: 400, credit: 0, memo: 'Recovered cash for refund dispute #1' },
        { accountId: 2, debit: 0, credit: 400, memo: 'Clear requester #3 dispute receivable' },
      ],
    });
  });

  it('write-off closes liability through one replay-safe Canonical outbox batch', async () => {
    const harness = await openDispute();
    const pending = await markRefundDisputeWriteoffPending(harness.db, {
      tenantId: 'tenant-1',
      disputeId: 1,
      approvalRequestId: 70,
      requestedBy: 4,
      idempotencyKey: 'writeoff-dispute-1',
    });
    expect(pending.status).toBe('writeoff_pending');

    const input = {
      tenantId: 'tenant-1',
      disputeId: 1,
      approvalRequestId: 70,
      approvedBy: 1,
      eventDate: '2026-07-29',
    } as const;
    const writtenOff = await completeRefundDisputeWriteoff(harness.db, input);
    const replay = await completeRefundDisputeWriteoff(harness.db, input);

    expect(writtenOff.status).toBe('written_off');
    expect(replay.status).toBe('written_off');
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM cash_drawer_movements WHERE movement_type = 'cash_in'").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare('SELECT status FROM billing_refund_cash_holds WHERE id = 9').get()).toEqual({ status: 'settled' });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM accounting_posting_events').get()).toEqual({ count: 2 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get()).toEqual({ count: 1 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_financial_batch_assertions').get()).toEqual({ count: 0 });

    await expect(completeRefundDisputeWriteoff(harness.db, {
      ...input,
      approvedBy: 2,
    })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);

    const writtenOffEvent = harness.sqlite.prepare(`
      SELECT payload_json
      FROM accounting_posting_events
      WHERE source_type = 'refund_cash_dispute_written_off'
    `).get() as { payload_json: string };
    expect(JSON.parse(writtenOffEvent.payload_json)).toEqual({
      lines: [
        { accountId: 3, debit: 400, credit: 0, memo: 'Authorized loss for refund dispute #1' },
        { accountId: 2, debit: 0, credit: 400, memo: 'Clear requester #3 dispute receivable' },
      ],
    });
  });

  it('rolls back the write-off event, outbox claim, and dispute state when a guarded row is stale', async () => {
    const harness = await openDispute();
    await markRefundDisputeWriteoffPending(harness.db, {
      tenantId: 'tenant-1',
      disputeId: 1,
      approvalRequestId: 70,
      requestedBy: 4,
      idempotencyKey: 'writeoff-dispute-1',
    });
    harness.sqlite.prepare("UPDATE billing_refund_cash_holds SET status = 'held' WHERE id = 9").run();

    await expect(completeRefundDisputeWriteoff(harness.db, {
      tenantId: 'tenant-1',
      disputeId: 1,
      approvalRequestId: 70,
      approvedBy: 1,
      eventDate: '2026-07-29',
    })).rejects.toThrow();

    expect(harness.sqlite.prepare('SELECT status FROM billing_refund_cash_disputes WHERE id = 1').get())
      .toEqual({ status: 'writeoff_pending' });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM accounting_posting_events WHERE source_type = 'refund_cash_dispute_written_off'").get())
      .toEqual({ count: 0 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_outbox_events').get())
      .toEqual({ count: 0 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM canonical_financial_batch_assertions').get())
      .toEqual({ count: 0 });
  });
});
