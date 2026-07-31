import type { D1PreparedStatement } from '@cloudflare/workers-types';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  resolveAccountMappings,
} from './accounting-posting';
import { shadowCreateCashLedgerEntry } from './cash-ledger-writer';
import {
  buildRestoreRefundCommissionReservationStatements,
  buildTransitionRefundCommissionReservationStatements,
  loadRefundCommissionReservationPreview,
} from './billing-refund-commission';
import {
  prepareClearRefundBatchAssertions,
  prepareRefundBatchAssertion,
} from './billing-refund-batch-guard';
import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalPreparedStatement,
} from './canonical/command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './canonical/financial-batch-assertion';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './canonical/source-mapping';
import { executeStrictFinancialMutation } from './canonical/strict-financial-mutation';
import { executeLiveRefundCompensationRelease } from './canonical/live-refund-compensation';
import {
  executeLiveCashCustodyMovement,
  prepareLiveCashCustodyMovement,
} from './canonical/live-cash-custody';

export type RefundCashDisputeStatus =
  | 'open'
  | 'recovery_pending'
  | 'recovered'
  | 'writeoff_pending'
  | 'written_off';

export type RefundCashDispute = {
  id: number;
  tenantId: string;
  refundCashHoldId: number;
  approvalRequestId: number;
  billId: number;
  requesterUserId: number;
  amount: number;
  status: RefundCashDisputeStatus;
  rejectionReason: string;
  rejectedBy: number;
  rejectedAt: string | null;
  custodyUserId: number | null;
  counterId: number;
  counterSessionId: number;
  disputeCashMovementId: number | null;
  settlementMethod: 'cash_recovery' | 'authorized_writeoff' | null;
  settlementReferenceType: string | null;
  settlementReferenceId: number | null;
  settlementIdempotencyKey: string | null;
  settledBy: number | null;
  settledAt: string | null;
};

type RefundCashDisputeRow = {
  id: number;
  tenant_id: string;
  refund_cash_hold_id: number;
  approval_request_id: number;
  bill_id: number;
  requester_user_id: number;
  amount: number;
  status: string;
  rejection_reason: string;
  rejected_by: number;
  rejected_at: string | null;
  custody_user_id: number | null;
  counter_id: number;
  counter_session_id: number;
  dispute_cash_movement_id: number | null;
  settlement_method: string | null;
  settlement_reference_type: string | null;
  settlement_reference_id: number | null;
  settlement_idempotency_key: string | null;
  settled_by: number | null;
  settled_at: string | null;
};

export type OpenRefundDisputeInput = {
  tenantId: string;
  holdId: number;
  approvalRequestId: number;
  billId: number;
  requesterUserId: number;
  amount: number;
  requesterCounterId: number;
  requesterCounterSessionId: number;
  requesterEmployeeId: number;
  custodyUserId: number | null;
  rejectedBy: number;
  reason: string;
};

function mapRefundCashDispute(row: RefundCashDisputeRow): RefundCashDispute {
  return {
    id: Number(row.id),
    tenantId: String(row.tenant_id),
    refundCashHoldId: Number(row.refund_cash_hold_id),
    approvalRequestId: Number(row.approval_request_id),
    billId: Number(row.bill_id),
    requesterUserId: Number(row.requester_user_id),
    amount: Number(row.amount),
    status: row.status as RefundCashDisputeStatus,
    rejectionReason: String(row.rejection_reason),
    rejectedBy: Number(row.rejected_by),
    rejectedAt: row.rejected_at ?? null,
    custodyUserId: row.custody_user_id == null ? null : Number(row.custody_user_id),
    counterId: Number(row.counter_id),
    counterSessionId: Number(row.counter_session_id),
    disputeCashMovementId: row.dispute_cash_movement_id == null ? null : Number(row.dispute_cash_movement_id),
    settlementMethod: row.settlement_method as RefundCashDispute['settlementMethod'],
    settlementReferenceType: row.settlement_reference_type ?? null,
    settlementReferenceId: row.settlement_reference_id == null ? null : Number(row.settlement_reference_id),
    settlementIdempotencyKey: row.settlement_idempotency_key ?? null,
    settledBy: row.settled_by == null ? null : Number(row.settled_by),
    settledAt: row.settled_at ?? null,
  };
}

function assertPositiveAmount(value: number): number {
  const amount = Math.round(Number(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Refund dispute amount must be greater than zero');
  return amount;
}

function requiredAccountId(value: number | undefined, key: string): number {
  const accountId = Number(value ?? 0);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error(`Missing accounting account mapping: ${key}`);
  }
  return accountId;
}

function manualJournalPayload(lines: Array<{ accountId: number; debit: number; credit: number; memo: string }>): string {
  return JSON.stringify({ lines });
}

export async function prepareRefundDisputeOpenedAccountingEvent(
  db: D1Database,
  input: OpenRefundDisputeInput & { eventDate: string },
): Promise<D1PreparedStatement> {
  const amount = assertPositiveAmount(input.amount);
  const mappings = await resolveAccountMappings(db, input.tenantId, ['employee_dispute_receivable', 'cash']);
  const disputeReceivable = requiredAccountId(mappings.employee_dispute_receivable, 'employee_dispute_receivable');
  const cash = requiredAccountId(mappings.cash, 'cash');
  const sourceType = 'refund_cash_dispute_opened';
  const sourceId = `hold:${input.holdId}`;
  const sourceEventKey = createPostingEventKey(sourceType, sourceId, ACCOUNTING_EVENT_TYPES.manualJournal);
  return db.prepare(`
    INSERT OR IGNORE INTO accounting_posting_events (
      tenant_id, source_event_key, source_type, source_id,
      event_type, event_date, payload_json, created_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM billing_refund_cash_disputes dispute
      WHERE dispute.tenant_id = ?
        AND dispute.refund_cash_hold_id = ?
        AND dispute.status = 'open'
        AND dispute.dispute_cash_movement_id IS NOT NULL
    )
  `).bind(
    input.tenantId,
    sourceEventKey,
    sourceType,
    sourceId,
    ACCOUNTING_EVENT_TYPES.manualJournal,
    input.eventDate,
    manualJournalPayload([
      { accountId: disputeReceivable, debit: amount, credit: 0, memo: `Requester #${input.requesterUserId} refund dispute receivable` },
      { accountId: cash, debit: 0, credit: amount, memo: `Rejected refund cash removed from counter #${input.requesterCounterId}` },
    ]),
    String(input.rejectedBy),
    input.tenantId,
    input.holdId,
  ) as unknown as D1PreparedStatement;
}

export async function prepareExecutedRefundDisputeOpenedAccountingEvent(
  db: D1Database,
  input: OpenRefundDisputeInput & { eventDate: string },
): Promise<D1PreparedStatement> {
  const amount = assertPositiveAmount(input.amount);
  const mappings = await resolveAccountMappings(db, input.tenantId, ['employee_dispute_receivable', 'cash']);
  const disputeReceivable = requiredAccountId(mappings.employee_dispute_receivable, 'employee_dispute_receivable');
  const cash = requiredAccountId(mappings.cash, 'cash');
  const sourceType = 'executed_refund_cash_dispute_opened';
  const sourceId = `hold:${input.holdId}`;
  const sourceEventKey = createPostingEventKey(sourceType, sourceId, ACCOUNTING_EVENT_TYPES.manualJournal);
  return db.prepare(`
    INSERT OR IGNORE INTO accounting_posting_events (
      tenant_id, source_event_key, source_type, source_id,
      event_type, event_date, payload_json, created_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM billing_refund_cash_disputes dispute
      WHERE dispute.tenant_id = ?
        AND dispute.refund_cash_hold_id = ?
        AND dispute.status = 'open'
        AND dispute.dispute_cash_movement_id IS NULL
    )
  `).bind(
    input.tenantId,
    sourceEventKey,
    sourceType,
    sourceId,
    ACCOUNTING_EVENT_TYPES.manualJournal,
    input.eventDate,
    manualJournalPayload([
      { accountId: disputeReceivable, debit: amount, credit: 0, memo: `Requester #${input.requesterUserId} executed refund recovery receivable` },
      { accountId: cash, debit: 0, credit: amount, memo: `Executed refund cash remains outside counter #${input.requesterCounterId}` },
    ]),
    String(input.rejectedBy),
    input.tenantId,
    input.holdId,
  ) as unknown as D1PreparedStatement;
}

async function prepareRefundDisputeSettlementAccountingEvent(
  db: D1Database,
  input: {
    tenantId: string;
    dispute: RefundCashDispute;
    eventDate: string;
    createdBy: number;
    stage: 'recovered' | 'written_off';
  },
): Promise<D1PreparedStatement> {
  const amount = assertPositiveAmount(input.dispute.amount);
  const mappingKeys = input.stage === 'recovered'
    ? ['cash', 'employee_dispute_receivable'] as const
    : ['general_expense', 'employee_dispute_receivable'] as const;
  const mappings = await resolveAccountMappings(db, input.tenantId, [...mappingKeys]);
  const disputeReceivable = requiredAccountId(mappings.employee_dispute_receivable, 'employee_dispute_receivable');
  const debitAccount = input.stage === 'recovered'
    ? requiredAccountId(mappings.cash, 'cash')
    : requiredAccountId(mappings.general_expense, 'general_expense');
  const sourceType = input.stage === 'recovered'
    ? 'refund_cash_dispute_recovered'
    : 'refund_cash_dispute_written_off';
  const sourceId = String(input.dispute.id);
  const sourceEventKey = createPostingEventKey(sourceType, sourceId, ACCOUNTING_EVENT_TYPES.manualJournal);
  const expectedStatus = input.stage === 'recovered' ? 'recovered' : 'written_off';
  const expectedMethod = input.stage === 'recovered' ? 'cash_recovery' : 'authorized_writeoff';
  return db.prepare(`
    INSERT OR IGNORE INTO accounting_posting_events (
      tenant_id, source_event_key, source_type, source_id,
      event_type, event_date, payload_json, created_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM billing_refund_cash_disputes dispute
      WHERE dispute.tenant_id = ?
        AND dispute.id = ?
        AND dispute.status = ?
        AND dispute.settlement_method = ?
    )
  `).bind(
    input.tenantId,
    sourceEventKey,
    sourceType,
    sourceId,
    ACCOUNTING_EVENT_TYPES.manualJournal,
    input.eventDate,
    manualJournalPayload([
      {
        accountId: debitAccount,
        debit: amount,
        credit: 0,
        memo: input.stage === 'recovered'
          ? `Recovered cash for refund dispute #${input.dispute.id}`
          : `Authorized loss for refund dispute #${input.dispute.id}`,
      },
      {
        accountId: disputeReceivable,
        debit: 0,
        credit: amount,
        memo: `Clear requester #${input.dispute.requesterUserId} dispute receivable`,
      },
    ]),
    String(input.createdBy),
    input.tenantId,
    input.dispute.id,
    expectedStatus,
    expectedMethod,
  ) as unknown as D1PreparedStatement;
}

export function prepareRefundDisputeRecoveredAccountingEvent(
  db: D1Database,
  input: { tenantId: string; dispute: RefundCashDispute; eventDate: string; createdBy: number },
): Promise<D1PreparedStatement> {
  return prepareRefundDisputeSettlementAccountingEvent(db, { ...input, stage: 'recovered' });
}

export function prepareRefundDisputeWrittenOffAccountingEvent(
  db: D1Database,
  input: { tenantId: string; dispute: RefundCashDispute; eventDate: string; createdBy: number },
): Promise<D1PreparedStatement> {
  return prepareRefundDisputeSettlementAccountingEvent(db, { ...input, stage: 'written_off' });
}

export function prepareCreateRefundDispute(
  db: D1Database,
  input: OpenRefundDisputeInput,
): D1PreparedStatement {
  const amount = assertPositiveAmount(input.amount);
  return db.prepare(`
    INSERT OR IGNORE INTO billing_refund_cash_disputes (
      tenant_id, refund_cash_hold_id, approval_request_id, bill_id,
      requester_user_id, amount, status, rejection_reason, rejected_by,
      rejected_at, custody_user_id, counter_id, counter_session_id,
      created_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now', '+6 hours'), ?, ?, ?,
           datetime('now', '+6 hours'), datetime('now', '+6 hours')
    WHERE EXISTS (
      SELECT 1 FROM billing_refund_cash_holds hold
      WHERE hold.tenant_id = ?
        AND hold.id = ?
        AND hold.approval_request_id = ?
        AND hold.bill_id = ?
        AND hold.status = 'held'
    )
      AND EXISTS (
        SELECT 1 FROM approval_requests approval
        WHERE approval.tenant_id = ?
          AND approval.id = ?
          AND approval.status = 'rejected'
          AND approval.reviewed_by = ?
      )
  `).bind(
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.billId,
    input.requesterUserId,
    amount,
    input.reason,
    input.rejectedBy,
    input.custodyUserId,
    input.requesterCounterId,
    input.requesterCounterSessionId,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.billId,
    input.tenantId,
    input.approvalRequestId,
    input.rejectedBy,
  ) as unknown as D1PreparedStatement;
}

export function prepareCreateExecutedRefundDispute(
  db: D1Database,
  input: OpenRefundDisputeInput,
): D1PreparedStatement {
  const amount = assertPositiveAmount(input.amount);
  return db.prepare(`
    INSERT OR IGNORE INTO billing_refund_cash_disputes (
      tenant_id, refund_cash_hold_id, approval_request_id, bill_id,
      requester_user_id, amount, status, rejection_reason, rejected_by,
      rejected_at, custody_user_id, counter_id, counter_session_id,
      created_at, updated_at
    )
    SELECT ?, ?, ?, ?, ?, ?, 'open', ?, ?, datetime('now', '+6 hours'), ?, ?, ?,
           datetime('now', '+6 hours'), datetime('now', '+6 hours')
    WHERE EXISTS (
      SELECT 1 FROM billing_refund_cash_holds hold
      WHERE hold.tenant_id = ?
        AND hold.id = ?
        AND hold.approval_request_id = ?
        AND hold.bill_id = ?
        AND hold.status = 'consumed'
        AND ABS(hold.amount - ?) < 0.001
    )
      AND EXISTS (
        SELECT 1 FROM approval_requests approval
        WHERE approval.tenant_id = ?
          AND approval.id = ?
          AND approval.status = 'rejected'
          AND approval.reviewed_by = ?
          AND approval.execution_status = 'succeeded'
      )
  `).bind(
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.billId,
    input.requesterUserId,
    amount,
    input.reason,
    input.rejectedBy,
    input.custodyUserId,
    input.requesterCounterId,
    input.requesterCounterSessionId,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.billId,
    amount,
    input.tenantId,
    input.approvalRequestId,
    input.rejectedBy,
  ) as unknown as D1PreparedStatement;
}

export function prepareCreateRefundDisputeCashOut(
  db: D1Database,
  input: OpenRefundDisputeInput,
): D1PreparedStatement {
  const amount = assertPositiveAmount(input.amount);
  return db.prepare(`
    INSERT OR IGNORE INTO cash_drawer_movements (
      tenant_id, counter_session_id, counter_id, employee_id,
      movement_type, amount, payment_method, description,
      reference_type, reference_id, created_by, created_at
    )
    SELECT ?, ?, ?, ?, 'cash_out', ?, 'cash', ?, 'refund_cash_dispute', ?, ?,
           datetime('now', '+6 hours')
    WHERE EXISTS (
      SELECT 1 FROM billing_refund_cash_disputes dispute
      WHERE dispute.tenant_id = ?
        AND dispute.refund_cash_hold_id = ?
        AND dispute.status = 'open'
    )
  `).bind(
    input.tenantId,
    input.requesterCounterSessionId,
    input.requesterCounterId,
    input.requesterEmployeeId,
    amount,
    `Rejected refund reserve #${input.holdId} moved to disputed cash`,
    input.holdId,
    input.rejectedBy,
    input.tenantId,
    input.holdId,
  ) as unknown as D1PreparedStatement;
}

export function prepareAttachRefundDisputeCashOut(
  db: D1Database,
  input: Pick<OpenRefundDisputeInput, 'tenantId' | 'holdId'>,
): D1PreparedStatement {
  return db.prepare(`
    UPDATE billing_refund_cash_disputes
    SET dispute_cash_movement_id = (
          SELECT movement.id
          FROM cash_drawer_movements movement
          WHERE movement.tenant_id = billing_refund_cash_disputes.tenant_id
            AND movement.reference_type = 'refund_cash_dispute'
            AND movement.reference_id = billing_refund_cash_disputes.refund_cash_hold_id
            AND movement.movement_type = 'cash_out'
          LIMIT 1
        ),
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND refund_cash_hold_id = ?
      AND status = 'open'
      AND EXISTS (
        SELECT 1
        FROM cash_drawer_movements movement
        WHERE movement.tenant_id = billing_refund_cash_disputes.tenant_id
          AND movement.reference_type = 'refund_cash_dispute'
          AND movement.reference_id = billing_refund_cash_disputes.refund_cash_hold_id
          AND movement.movement_type = 'cash_out'
      )
  `).bind(input.tenantId, input.holdId) as unknown as D1PreparedStatement;
}

export function prepareMarkRefundHoldDisputed(
  db: D1Database,
  input: Pick<OpenRefundDisputeInput, 'tenantId' | 'holdId' | 'approvalRequestId' | 'rejectedBy' | 'reason'>,
): D1PreparedStatement {
  const accountingSourceEventKey = createPostingEventKey(
    'refund_cash_dispute_opened',
    `hold:${input.holdId}`,
    ACCOUNTING_EVENT_TYPES.manualJournal,
  );
  return db.prepare(`
    UPDATE billing_refund_cash_holds
    SET status = 'disputed',
        resolved_by = ?,
        resolution_reason = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND id = ?
      AND approval_request_id = ?
      AND status = 'held'
      AND EXISTS (
        SELECT 1
        FROM billing_refund_cash_disputes dispute
        WHERE dispute.tenant_id = billing_refund_cash_holds.tenant_id
          AND dispute.refund_cash_hold_id = billing_refund_cash_holds.id
          AND dispute.status = 'open'
          AND dispute.dispute_cash_movement_id IS NOT NULL
      )
      AND EXISTS (
        SELECT 1
        FROM accounting_posting_events event
        WHERE event.tenant_id = billing_refund_cash_holds.tenant_id
          AND event.source_event_key = ?
          AND event.event_type = 'manual_journal'
      )
  `).bind(
    input.rejectedBy,
    input.reason,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    accountingSourceEventKey,
  ) as unknown as D1PreparedStatement;
}

export function prepareMarkExecutedRefundHoldDisputed(
  db: D1Database,
  input: Pick<OpenRefundDisputeInput, 'tenantId' | 'holdId' | 'approvalRequestId' | 'rejectedBy' | 'reason'>,
): D1PreparedStatement {
  const accountingSourceEventKey = createPostingEventKey(
    'executed_refund_cash_dispute_opened',
    `hold:${input.holdId}`,
    ACCOUNTING_EVENT_TYPES.manualJournal,
  );
  return db.prepare(`
    UPDATE billing_refund_cash_holds
    SET status = 'disputed',
        release_status = 'not_applicable',
        resolved_by = ?,
        resolution_reason = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND id = ?
      AND approval_request_id = ?
      AND status = 'consumed'
      AND EXISTS (
        SELECT 1
        FROM billing_refund_cash_disputes dispute
        WHERE dispute.tenant_id = billing_refund_cash_holds.tenant_id
          AND dispute.refund_cash_hold_id = billing_refund_cash_holds.id
          AND dispute.status = 'open'
          AND dispute.dispute_cash_movement_id IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM accounting_posting_events event
        WHERE event.tenant_id = billing_refund_cash_holds.tenant_id
          AND event.source_event_key = ?
          AND event.event_type = 'manual_journal'
      )
  `).bind(
    input.rejectedBy,
    input.reason,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    accountingSourceEventKey,
  ) as unknown as D1PreparedStatement;
}

export async function loadRefundCashDispute(
  db: D1Database,
  tenantId: string,
  disputeId: number,
): Promise<RefundCashDispute | null> {
  const row = await db.prepare(`
    SELECT *
    FROM billing_refund_cash_disputes
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, disputeId).first<RefundCashDisputeRow>();
  return row ? mapRefundCashDispute(row) : null;
}

export async function loadRefundCashDisputeByHold(
  db: D1Database,
  tenantId: string,
  holdId: number,
): Promise<RefundCashDispute | null> {
  const row = await db.prepare(`
    SELECT *
    FROM billing_refund_cash_disputes
    WHERE tenant_id = ? AND refund_cash_hold_id = ?
    LIMIT 1
  `).bind(tenantId, holdId).first<RefundCashDisputeRow>();
  return row ? mapRefundCashDispute(row) : null;
}

export async function recoverRefundDispute(
  db: D1Database,
  input: {
    tenantId: string;
    disputeId: number;
    destinationCounterSessionId: number;
    destinationCounterId: number;
    destinationEmployeeId: number;
    recoveredBy: number;
    idempotencyKey: string;
    notes?: string;
    eventDate?: string;
  },
): Promise<RefundCashDispute> {
  const existing = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
  if (!existing) throw new Error('Refund cash dispute not found');
  if (existing.status === 'recovered' && existing.settlementIdempotencyKey === input.idempotencyKey) return existing;
  if (existing.status !== 'open' && existing.status !== 'recovery_pending') {
    throw new Error(`Refund cash dispute cannot be recovered from status ${existing.status}`);
  }

  const destination = await db.prepare(`
    SELECT id
    FROM billing_counter_sessions
    WHERE tenant_id = ?
      AND id = ?
      AND counter_id = ?
      AND employee_id = ?
      AND status = 'active'
      AND COALESCE(variance_approval_status, '') <> 'pending'
    LIMIT 1
  `).bind(
    input.tenantId,
    input.destinationCounterSessionId,
    input.destinationCounterId,
    input.destinationEmployeeId,
  ).first<{ id: number }>();
  if (!destination) throw new Error('An active destination counter session is required to recover disputed cash');

  const occurredAtUtc = new Date().toISOString();
  const eventDate = input.eventDate ?? occurredAtUtc.slice(0, 10);
  const accountingStatement = await prepareRefundDisputeRecoveredAccountingEvent(db, {
    tenantId: input.tenantId,
    dispute: existing,
    eventDate,
    createdBy: input.recoveredBy,
  });
  const commissionRestoreStatements = await buildRestoreRefundCommissionReservationStatements(db, {
    tenantId: input.tenantId,
    approvalRequestId: existing.approvalRequestId,
    userId: input.recoveredBy,
    eventDate,
    reason: input.notes?.trim() || `Disputed cash recovered for refund approval #${existing.approvalRequestId}`,
  });
  const operationKey = `refund-dispute-recovery:${existing.id}:${input.idempotencyKey}`;
  const approvalSource = await db.prepare(`
    SELECT json_extract(request_data, '$.refundRequestIdempotencyKey') refund_source_public_id
    FROM approval_requests
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(input.tenantId, existing.approvalRequestId).first<{ refund_source_public_id: string | null }>();

  const legacyStatements = [
    db.prepare(`
      INSERT OR IGNORE INTO cash_drawer_movements (
        tenant_id, counter_session_id, counter_id, employee_id,
        movement_type, amount, payment_method, description,
        reference_type, reference_id, created_by, created_at
      ) VALUES (?, ?, ?, ?, 'cash_in', ?, 'cash', ?, 'refund_cash_dispute', ?, ?, datetime('now', '+6 hours'))
    `).bind(
      input.tenantId,
      input.destinationCounterSessionId,
      input.destinationCounterId,
      input.destinationEmployeeId,
      existing.amount,
      input.notes?.trim() || `Recovered refund dispute #${existing.id}`,
      existing.refundCashHoldId,
      input.recoveredBy,
    ),
    prepareRefundBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'cash-in',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE billing_refund_cash_disputes
      SET status = 'recovered',
          settlement_method = 'cash_recovery',
          settlement_reference_type = 'cash_drawer_movement',
          settlement_reference_id = (
            SELECT movement.id
            FROM cash_drawer_movements movement
            WHERE movement.tenant_id = billing_refund_cash_disputes.tenant_id
              AND movement.reference_type = 'refund_cash_dispute'
              AND movement.reference_id = billing_refund_cash_disputes.refund_cash_hold_id
              AND movement.movement_type = 'cash_in'
            LIMIT 1
          ),
          settlement_idempotency_key = ?,
          settled_by = ?,
          settled_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status IN ('open', 'recovery_pending')
        AND EXISTS (
          SELECT 1
          FROM cash_drawer_movements movement
          WHERE movement.tenant_id = billing_refund_cash_disputes.tenant_id
            AND movement.reference_type = 'refund_cash_dispute'
            AND movement.reference_id = billing_refund_cash_disputes.refund_cash_hold_id
            AND movement.movement_type = 'cash_in'
        )
    `).bind(input.idempotencyKey, input.recoveredBy, input.tenantId, input.disputeId),
    prepareRefundBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'dispute-state',
      expectedChanges: 1,
    }),
    accountingStatement,
    prepareRefundBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'accounting',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE billing_refund_cash_holds
      SET status = 'settled',
          resolved_by = ?,
          resolution_reason = 'Disputed cash recovered',
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'disputed'
        AND EXISTS (
          SELECT 1 FROM billing_refund_cash_disputes dispute
          WHERE dispute.tenant_id = billing_refund_cash_holds.tenant_id
            AND dispute.id = ?
            AND dispute.status = 'recovered'
        )
    `).bind(input.recoveredBy, input.tenantId, existing.refundCashHoldId, input.disputeId),
    prepareRefundBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'cash-hold',
      expectedChanges: 1,
    }),
    ...commissionRestoreStatements,
    prepareClearRefundBatchAssertions(db, input.tenantId, operationKey),
  ];
  const custodyInput = {
    tenantId: input.tenantId,
    custodyType: 'counter_session' as const,
    legacyCounterId: input.destinationCounterId,
    legacyCounterSessionId: input.destinationCounterSessionId,
    movementType: 'adjustment' as const,
    direction: 'in' as const,
    amount: existing.amount,
    occurredAtUtc,
    businessDate: eventDate,
    sourceType: 'legacy_refund_cash_dispute_recovery',
    sourcePublicId: `dispute:${existing.id}:${input.idempotencyKey}`,
    sourceTable: 'cash_drawer_movements',
    evidence: {
      disputeId: existing.id,
      refundCashHoldId: existing.refundCashHoldId,
      approvalRequestId: existing.approvalRequestId,
      recoveredBy: input.recoveredBy,
      destinationEmployeeId: input.destinationEmployeeId,
    },
  };

  if (commissionRestoreStatements.length > 0) {
    await executeStrictFinancialMutation({
      db,
      tenantId: input.tenantId,
      boundary: 'doctor-compensation.refund-release',
      legacyStatements,
      canonical: async (options) => {
        const refundSourcePublicId = String(approvalSource?.refund_source_public_id ?? '').trim();
        if (!refundSourcePublicId) {
          throw new Error('Refund dispute recovery is missing the canonical refund source identity');
        }
        const custody = await prepareLiveCashCustodyMovement(db, custodyInput);
        return executeLiveRefundCompensationRelease(db, {
          tenantId: input.tenantId,
          refundSourcePublicId,
          occurredAtUtc,
          businessDate: eventDate,
          reasonCode: 'refund_dispute_recovered',
        }, {
          authoritativeStatements: [
            ...(options.authoritativeStatements ?? []),
            ...custody.statements,
          ],
        });
      },
    });
  } else {
    await executeLiveCashCustodyMovement(db, {
      ...custodyInput,
      legacyStatements,
    });
  }

  const recovered = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
  if (!recovered || recovered.status !== 'recovered') throw new Error('Recovered refund cash dispute could not be verified');
  return recovered;
}

export async function markRefundDisputeWriteoffPending(
  db: D1Database,
  input: {
    tenantId: string;
    disputeId: number;
    approvalRequestId: number;
    requestedBy: number;
    idempotencyKey: string;
  },
): Promise<RefundCashDispute> {
  const existing = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
  if (!existing) throw new Error('Refund cash dispute not found');
  if (existing.status === 'writeoff_pending'
    && existing.settlementReferenceId === input.approvalRequestId
    && existing.settlementIdempotencyKey === input.idempotencyKey) return existing;
  if (existing.status !== 'open') throw new Error(`Refund cash dispute cannot request write-off from status ${existing.status}`);

  const result = await db.prepare(`
    UPDATE billing_refund_cash_disputes
    SET status = 'writeoff_pending',
        settlement_method = 'authorized_writeoff',
        settlement_reference_type = 'approval_request',
        settlement_reference_id = ?,
        settlement_idempotency_key = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND id = ? AND status = 'open'
  `).bind(
    input.approvalRequestId,
    input.idempotencyKey,
    input.tenantId,
    input.disputeId,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error('Refund cash dispute write-off request could not be recorded');
  const pending = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
  if (!pending || pending.status !== 'writeoff_pending') throw new Error('Refund cash dispute write-off request could not be verified');
  return pending;
}

type RefundDisputeWriteoffCommandResult = {
  disputeId: number;
  approvalRequestId: number;
  refundCashHoldId: number;
  amountMinor: number;
  status: 'written_off';
};

export async function completeRefundDisputeWriteoff(
  db: D1Database,
  input: {
    tenantId: string;
    disputeId: number;
    approvalRequestId: number;
    approvedBy: number;
    eventDate?: string;
  },
): Promise<RefundCashDispute> {
  const canonicalDb = db as unknown as CanonicalBatchDatabase;
  const commandName = 'canonical.refund_dispute.writeoff';
  const operationKey = `refund-dispute-writeoff:${input.disputeId}:${input.approvalRequestId}`;
  const request = {
    disputeId: input.disputeId,
    approvalRequestId: input.approvalRequestId,
    approvedBy: input.approvedBy,
    eventDate: input.eventDate ?? null,
  };
  const replay = await readCanonicalCommandReplay<RefundDisputeWriteoffCommandResult>(canonicalDb, {
    tenantId: input.tenantId,
    commandName,
    idempotencyKey: operationKey,
    request,
  });
  if (replay) {
    const replayed = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
    if (!replayed || replayed.status !== 'written_off') {
      throw new Error('Canonical refund dispute write-off receipt does not match stored state');
    }
    return replayed;
  }

  const existing = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
  if (!existing) throw new Error('Refund cash dispute not found');
  if (existing.status === 'written_off' && existing.settlementReferenceId === input.approvalRequestId) return existing;
  if (existing.status !== 'writeoff_pending' || existing.settlementReferenceId !== input.approvalRequestId) {
    throw new Error('Refund cash dispute is not pending this authorized write-off approval');
  }

  const occurredAtUtc = new Date().toISOString();
  const businessDate = input.eventDate ?? occurredAtUtc.slice(0, 10);
  const accountingStatement = await prepareRefundDisputeWrittenOffAccountingEvent(db, {
    tenantId: input.tenantId,
    dispute: existing,
    eventDate: businessDate,
    createdBy: input.approvedBy,
  });

  const commissionReservation = await loadRefundCommissionReservationPreview(
    db,
    input.tenantId,
    existing.approvalRequestId,
  );
  const reservedCommissionRows = commissionReservation?.status === 'disputed'
    ? commissionReservation.rows.filter((row) => row.reversalAmount > 0)
    : [];
  const commissionStateStatements = reservedCommissionRows.length > 0
    ? [
      ...buildTransitionRefundCommissionReservationStatements(db, {
        tenantId: input.tenantId,
        approvalRequestId: existing.approvalRequestId,
        fromStatus: 'disputed',
        toStatus: 'written_off',
        userId: input.approvedBy,
        reason: 'Refund dispute resolved by authorized write-off',
        expectedChanges: reservedCommissionRows.length,
        operationKey,
      }),
      db.prepare(`
        UPDATE approval_requests
        SET request_data = json_set(request_data, '$.commissionReservationStatus', 'written_off')
        WHERE tenant_id = ? AND id = ?
      `).bind(input.tenantId, existing.approvalRequestId),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: 'request-data',
        expectedChanges: 1,
      }),
    ]
    : [];

  const statements: D1PreparedStatement[] = [
    db.prepare(`
      UPDATE billing_refund_cash_disputes
      SET status = 'written_off',
          settlement_method = 'authorized_writeoff',
          settled_by = ?,
          settled_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'writeoff_pending'
        AND settlement_reference_type = 'approval_request'
        AND settlement_reference_id = ?
    `).bind(input.approvedBy, input.tenantId, input.disputeId, input.approvalRequestId),
    prepareFinancialBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'dispute-state',
      expectedChanges: 1,
    }),
    accountingStatement,
    prepareFinancialBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'accounting',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE billing_refund_cash_holds
      SET status = 'settled',
          resolved_by = ?,
          resolution_reason = 'Disputed cash written off by authorized approval',
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status = 'disputed'
        AND EXISTS (
          SELECT 1 FROM billing_refund_cash_disputes dispute
          WHERE dispute.tenant_id = billing_refund_cash_holds.tenant_id
            AND dispute.id = ?
            AND dispute.status = 'written_off'
        )
    `).bind(input.approvedBy, input.tenantId, existing.refundCashHoldId, input.disputeId),
    prepareFinancialBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'cash-hold',
      expectedChanges: 1,
    }),
    ...commissionStateStatements,
    prepareClearRefundBatchAssertions(db, input.tenantId, operationKey),
    prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey),
  ];
  const amountMinor = Math.round(existing.amount * 100);
  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'refund_cash_dispute_writeoff',
    disputeId: existing.id,
    approvalRequestId: existing.approvalRequestId,
    refundCashHoldId: existing.refundCashHoldId,
    billId: existing.billId,
    amountMinor,
    approvedBy: input.approvedBy,
  });
  const result: RefundDisputeWriteoffCommandResult = {
    disputeId: existing.id,
    approvalRequestId: existing.approvalRequestId,
    refundCashHoldId: existing.refundCashHoldId,
    amountMinor,
    status: 'written_off',
  };
  await runCanonicalBatch(canonicalDb, {
    tenantId: input.tenantId,
    commandName,
    idempotencyKey: operationKey,
    request,
    statements: statements as unknown as readonly CanonicalPreparedStatement[],
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt',
        input.tenantId,
        'refund_cash_dispute_writeoff',
        `${existing.id}:${input.approvalRequestId}`,
      ),
      aggregateType: 'refund_cash_dispute',
      aggregatePublicId: String(existing.id),
      eventType: 'canonical.refund_dispute.written_off',
      occurredAtUtc,
      businessDate,
      payload: {
        ...result,
        billId: existing.billId,
        approvedBy: input.approvedBy,
        sourceEvidenceSha256,
      },
    },
  });

  const writtenOff = await loadRefundCashDispute(db, input.tenantId, input.disputeId);
  if (!writtenOff || writtenOff.status !== 'written_off') throw new Error('Written-off refund cash dispute could not be verified');
  return writtenOff;
}

export async function shadowRefundDisputeOpened(
  db: D1Database,
  dispute: RefundCashDispute,
  createdBy: number,
): Promise<void> {
  await shadowCreateCashLedgerEntry(db, {
    tenantId: dispute.tenantId,
    sourceType: 'refund_cash_dispute',
    sourceId: dispute.id,
    sourceNo: `RCD-${dispute.id}`,
    eventType: 'REFUND_CASH_DISPUTED',
    movementDirection: 'out',
    cashStatus: 'DISPUTED',
    status: dispute.status,
    amount: dispute.amount,
    expectedAmount: dispute.amount,
    receivedAmount: 0,
    dueAmount: dispute.amount,
    paymentMethod: 'cash',
    fromUserId: dispute.requesterUserId,
    toUserId: dispute.custodyUserId ?? dispute.requesterUserId,
    counterSessionId: dispute.counterSessionId,
    counterId: dispute.counterId,
    currentLocationType: 'disputed',
    currentLocationLabel: `Requester #${dispute.requesterUserId} refund dispute`,
    referenceType: 'refund_cash_dispute',
    referenceId: dispute.id,
    note: dispute.rejectionReason,
    metadata: {
      refundCashHoldId: dispute.refundCashHoldId,
      approvalRequestId: dispute.approvalRequestId,
      billId: dispute.billId,
      requesterUserId: dispute.requesterUserId,
    },
    idempotencyKey: `cash-ledger:refund-dispute:${dispute.id}:opened`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}

export async function shadowRefundDisputeRecovered(
  db: D1Database,
  dispute: RefundCashDispute,
  destination: { counterSessionId: number; counterId: number; employeeId: number },
  createdBy: number,
): Promise<void> {
  await shadowCreateCashLedgerEntry(db, {
    tenantId: dispute.tenantId,
    sourceType: 'refund_cash_dispute',
    sourceId: dispute.id,
    sourceNo: `RCD-${dispute.id}`,
    eventType: 'REFUND_CASH_DISPUTE_RECOVERED',
    movementDirection: 'in',
    cashStatus: 'IN_DRAWER',
    status: dispute.status,
    amount: dispute.amount,
    expectedAmount: dispute.amount,
    receivedAmount: dispute.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: dispute.requesterUserId,
    toUserId: destination.employeeId,
    counterSessionId: destination.counterSessionId,
    counterId: destination.counterId,
    currentLocationType: 'drawer',
    currentLocationLabel: `Counter session #${destination.counterSessionId}`,
    referenceType: 'refund_cash_dispute',
    referenceId: dispute.id,
    metadata: {
      refundCashHoldId: dispute.refundCashHoldId,
      approvalRequestId: dispute.approvalRequestId,
      billId: dispute.billId,
      requesterUserId: dispute.requesterUserId,
    },
    idempotencyKey: `cash-ledger:refund-dispute:${dispute.id}:recovered`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}

export async function shadowRefundDisputeWrittenOff(
  db: D1Database,
  dispute: RefundCashDispute,
  createdBy: number,
): Promise<void> {
  await shadowCreateCashLedgerEntry(db, {
    tenantId: dispute.tenantId,
    sourceType: 'refund_cash_dispute',
    sourceId: dispute.id,
    sourceNo: `RCD-${dispute.id}`,
    eventType: 'REFUND_CASH_DISPUTE_WRITTEN_OFF',
    movementDirection: 'neutral',
    cashStatus: 'WRITTEN_OFF',
    status: dispute.status,
    amount: dispute.amount,
    expectedAmount: dispute.amount,
    receivedAmount: 0,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: dispute.requesterUserId,
    toUserId: null,
    counterSessionId: dispute.counterSessionId,
    counterId: dispute.counterId,
    currentLocationType: 'written_off',
    currentLocationLabel: `Authorized write-off for refund dispute #${dispute.id}`,
    referenceType: 'refund_cash_dispute',
    referenceId: dispute.id,
    metadata: {
      refundCashHoldId: dispute.refundCashHoldId,
      approvalRequestId: dispute.approvalRequestId,
      billId: dispute.billId,
      requesterUserId: dispute.requesterUserId,
    },
    idempotencyKey: `cash-ledger:refund-dispute:${dispute.id}:written-off`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}
