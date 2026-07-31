import type { D1PreparedStatement } from '@cloudflare/workers-types';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  resolveAccountMappings,
} from './accounting-posting';
import {
  loadRefundCashHold,
  prepareCreditReturnedExecutedRefundCash,
  prepareSettleExecutedRefundHold,
} from './billing-refund-cash-hold';
import {
  prepareCreateExecutedRefundDispute,
  prepareExecutedRefundDisputeOpenedAccountingEvent,
  prepareMarkExecutedRefundHoldDisputed,
  type OpenRefundDisputeInput,
} from './billing-refund-dispute';
import {
  buildRestoreExecutedRefundCommissionStatements,
  type ExecutedRefundCommissionImpactSnapshot,
} from './billing-refund-commission';
import {
  prepareClearRefundBatchAssertions,
  prepareRefundBatchAssertion,
} from './billing-refund-batch-guard';
import { reverseCreditNoteCashRefund } from './canonical/commands/reverse-credit-note-cash-refund';
import { resolveLiveCreditNoteCashRefundReversal } from './canonical/live-credit-note-cash-refund-reversal';
import { prepareLiveCashCustodyMovement } from './canonical/live-cash-custody';
import { executeStrictFinancialMutation } from './canonical/strict-financial-mutation';
import { createDeterministicSourceId } from './canonical/source-mapping';
import { getTodayGMT6 } from './date-utils';

export type ExecutedRefundBillSnapshot = {
  total: number;
  paid: number;
  due: number;
  status: string;
  testBill: number;
  doctorVisitBill: number;
  admissionBill: number;
  operationBill: number;
  medicineBill: number;
};

export type BuildExecutedRefundRequestDataInput = {
  requestData: Record<string, unknown>;
  refundRequestIdempotencyKey: string;
  refundRequestHash: string;
  totalRefund: number;
  cashRefund: number;
  receivableReduction: number;
  counterId: number;
  counterSessionId: number;
  creditNoteNo: string;
  originalBill: ExecutedRefundBillSnapshot;
  refundedBill: ExecutedRefundBillSnapshot;
};

function parseData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function money(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} cannot be empty`);
  return normalized;
}

function billSnapshot(value: ExecutedRefundBillSnapshot): ExecutedRefundBillSnapshot {
  return {
    total: money(value.total),
    paid: money(value.paid),
    due: money(value.due),
    status: requiredText(value.status, 'bill.status'),
    testBill: money(value.testBill),
    doctorVisitBill: money(value.doctorVisitBill),
    admissionBill: money(value.admissionBill),
    operationBill: money(value.operationBill),
    medicineBill: money(value.medicineBill),
  };
}

export function buildExecutedRefundRequestData(
  input: BuildExecutedRefundRequestDataInput,
): Record<string, unknown> {
  const totalRefund = money(input.totalRefund);
  const cashRefund = money(input.cashRefund);
  const receivableReduction = money(input.receivableReduction);
  if (totalRefund <= 0) throw new RangeError('totalRefund must be greater than zero');
  if (cashRefund <= 0) throw new RangeError('cashRefund must be greater than zero');
  if (cashRefund + receivableReduction !== totalRefund) {
    throw new RangeError('cash refund and receivable reduction must equal total refund');
  }

  return {
    ...parseData(input.requestData),
    paymentMethod: 'cash',
    executionMode: 'executed_pending',
    financialState: 'refunded_pending_review',
    cashHoldStatus: 'consumed',
    approvalRevision: 1,
    requestedRefundAmount: totalRefund,
    cashRefundAmount: cashRefund,
    receivableReduction,
    refundRequestIdempotencyKey: requiredText(
      input.refundRequestIdempotencyKey,
      'refundRequestIdempotencyKey',
    ),
    refundRequestHash: requiredText(input.refundRequestHash, 'refundRequestHash'),
    counterId: positiveInteger(input.counterId, 'counterId'),
    counterSessionId: positiveInteger(input.counterSessionId, 'counterSessionId'),
    creditNoteNo: requiredText(input.creditNoteNo, 'creditNoteNo'),
    originalBill: billSnapshot(input.originalBill),
    refundedBill: billSnapshot(input.refundedBill),
  };
}

export function isExecutedPendingApproval(request: unknown): boolean {
  if (!request || typeof request !== 'object') return false;
  const row = request as Record<string, unknown>;
  const type = String(row.type ?? row.approval_type ?? '').trim().toLowerCase();
  if (!['refund', 'payment_void'].includes(type)) return false;
  const data = parseData(row.request_data);
  return data.executionMode === 'executed_pending'
    && String(row.execution_status ?? '') === 'succeeded';
}

export type ExecutedRefundCashResolution = 'cash_returned' | 'open_dispute';

export type ResolveExecutedRefundRejectionInput = {
  cashResolution?: ExecutedRefundCashResolution;
  cashReturnedAcknowledged?: true;
  idempotencyKey?: string;
};

export type ExecutedRefundRejectionResolution = {
  cashResolution: ExecutedRefundCashResolution;
  cashReturnedAcknowledged: boolean;
  idempotencyKey: string;
};

export type ExecutedRefundCashReturnCandidate = {
  counterSessionId: number;
  counterId: number;
  employeeId: number;
};

export type EligibleExecutedRefundCashReturnSession = {
  counterId: number;
  employeeId: number;
};

export async function loadEligibleExecutedRefundCashReturnSessions(
  db: D1Database,
  tenantId: string,
  candidates: ExecutedRefundCashReturnCandidate[],
): Promise<Map<number, EligibleExecutedRefundCashReturnSession>> {
  const normalizedTenantId = String(tenantId ?? '').trim();
  if (!normalizedTenantId) return new Map();
  const sessionIds = Array.from(new Set(candidates.flatMap((candidate) => {
    const counterSessionId = Number(candidate.counterSessionId);
    const counterId = Number(candidate.counterId);
    const employeeId = Number(candidate.employeeId);
    return Number.isSafeInteger(counterSessionId) && counterSessionId > 0
      && Number.isSafeInteger(counterId) && counterId > 0
      && Number.isSafeInteger(employeeId) && employeeId > 0
      ? [counterSessionId]
      : [];
  })));
  if (sessionIds.length === 0) return new Map();

  const placeholders = sessionIds.map(() => '?').join(',');
  let rows: Array<{ id: number; counter_id: number; employee_id: number }>;
  try {
    const result = await db.prepare(`
      SELECT id, counter_id, employee_id
      FROM billing_counter_sessions
      WHERE tenant_id = ?
        AND id IN (${placeholders})
        AND status = 'active'
        AND COALESCE(variance_approval_status, '') <> 'pending'
    `).bind(normalizedTenantId, ...sessionIds).all<{
      id: number;
      counter_id: number;
      employee_id: number;
    }>();
    rows = result.results ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no such table:\s*billing_counter_sessions|D1_ERROR.*billing_counter_sessions/i.test(message)) {
      return new Map();
    }
    throw error;
  }

  const eligible = new Map<number, EligibleExecutedRefundCashReturnSession>();
  for (const row of rows) {
    const sessionId = Number(row.id);
    const counterId = Number(row.counter_id);
    const employeeId = Number(row.employee_id);
    if (Number.isSafeInteger(sessionId) && sessionId > 0
      && Number.isSafeInteger(counterId) && counterId > 0
      && Number.isSafeInteger(employeeId) && employeeId > 0) {
      eligible.set(sessionId, { counterId, employeeId });
    }
  }
  return eligible;
}

export function resolveExecutedRefundRejection(
  input: ResolveExecutedRefundRejectionInput,
): ExecutedRefundRejectionResolution {
  const idempotencyKey = String(input.idempotencyKey ?? '').trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new RangeError('Executed refund rejection idempotency key must be 8-128 characters');
  }
  const cashResolution = input.cashResolution ?? 'open_dispute';
  if (cashResolution === 'cash_returned' && input.cashReturnedAcknowledged !== true) {
    throw new Error('Cash return acknowledgement is required');
  }
  return {
    cashResolution,
    cashReturnedAcknowledged: input.cashReturnedAcknowledged === true,
    idempotencyKey,
  };
}

function requiredAccountId(value: number | undefined, key: string): number {
  const accountId = Number(value ?? 0);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error(`Missing accounting account mapping: ${key}`);
  }
  return accountId;
}

function storedBillSnapshot(value: unknown, label: string): ExecutedRefundBillSnapshot {
  const data = parseData(value);
  const snapshot = billSnapshot({
    total: Number(data.total ?? 0),
    paid: Number(data.paid ?? 0),
    due: Number(data.due ?? 0),
    status: String(data.status ?? ''),
    testBill: Number(data.testBill ?? 0),
    doctorVisitBill: Number(data.doctorVisitBill ?? 0),
    admissionBill: Number(data.admissionBill ?? 0),
    operationBill: Number(data.operationBill ?? 0),
    medicineBill: Number(data.medicineBill ?? 0),
  });
  if (snapshot.total < 0 || snapshot.paid < 0 || snapshot.due < 0) {
    throw new Error(`${label} contains invalid negative balances`);
  }
  if (money(snapshot.paid + snapshot.due) !== snapshot.total) {
    throw new Error(`${label} does not reconcile`);
  }
  return snapshot;
}

function commissionSnapshots(value: unknown): ExecutedRefundCommissionImpactSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    const data = parseData(row);
    const snapshot: ExecutedRefundCommissionImpactSnapshot = {
      accrualId: Number(data.accrualId ?? 0),
      billId: Number(data.billId ?? 0),
      oldCommissionBaseAmount: money(Number(data.oldCommissionBaseAmount ?? 0)),
      oldEarnedCommissionAmount: money(Number(data.oldEarnedCommissionAmount ?? 0)),
      oldDoctorWaiverAmount: money(Number(data.oldDoctorWaiverAmount ?? 0)),
      oldPayableCommissionAmount: money(Number(data.oldPayableCommissionAmount ?? 0)),
      oldBalanceAmount: money(Number(data.oldBalanceAmount ?? 0)),
      newCommissionBaseAmount: money(Number(data.newCommissionBaseAmount ?? 0)),
      newEarnedCommissionAmount: money(Number(data.newEarnedCommissionAmount ?? 0)),
      newDoctorWaiverAmount: money(Number(data.newDoctorWaiverAmount ?? 0)),
      newPayableCommissionAmount: money(Number(data.newPayableCommissionAmount ?? 0)),
      newBalanceAmount: money(Number(data.newBalanceAmount ?? 0)),
      paidAmount: money(Number(data.paidAmount ?? 0)),
      reversalAmount: money(Number(data.reversalAmount ?? 0)),
    };
    if (snapshot.accrualId <= 0 || snapshot.billId <= 0 || snapshot.reversalAmount <= 0) {
      throw new Error(`commissionImpactRows[${index}] is invalid`);
    }
    return snapshot;
  });
}

async function prepareExecutedRefundReversalAccountingEvent(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestId: number;
    reviewerId: number;
    eventDate: string;
    totalRefund: number;
    cashRefund: number;
    receivableReduction: number;
    originalBill: ExecutedRefundBillSnapshot;
    refundedBill: ExecutedRefundBillSnapshot;
  },
): Promise<D1PreparedStatement> {
  const categoryDeltas = [
    { key: 'lab_revenue', amount: money(input.originalBill.testBill - input.refundedBill.testBill), memo: 'Restore diagnostic revenue' },
    { key: 'doctor_visit_revenue', amount: money(input.originalBill.doctorVisitBill - input.refundedBill.doctorVisitBill), memo: 'Restore doctor visit revenue' },
    { key: 'admission_revenue', amount: money(input.originalBill.admissionBill - input.refundedBill.admissionBill), memo: 'Restore admission revenue' },
    { key: 'operation_revenue', amount: money(input.originalBill.operationBill - input.refundedBill.operationBill), memo: 'Restore operation revenue' },
    { key: 'pharmacy_revenue', amount: money(input.originalBill.medicineBill - input.refundedBill.medicineBill), memo: 'Restore pharmacy revenue' },
  ].filter((row) => row.amount > 0);
  const categorized = money(categoryDeltas.reduce((sum, row) => sum + row.amount, 0));
  const otherRevenue = money(input.totalRefund - categorized);
  if (otherRevenue < 0) throw new Error('Executed refund revenue reversal does not reconcile');

  const mappingKeys = [
    ...(input.cashRefund > 0 ? ['cash'] : []),
    ...(input.receivableReduction > 0 ? ['accounts_receivable'] : []),
    ...categoryDeltas.map((row) => row.key),
    ...(otherRevenue > 0 ? ['other_revenue'] : []),
  ];
  const mappings = await resolveAccountMappings(db, input.tenantId, mappingKeys as any);
  const lines: Array<{ accountId: number; debit: number; credit: number; memo: string }> = [];
  if (input.cashRefund > 0) {
    lines.push({
      accountId: requiredAccountId(mappings.cash, 'cash'),
      debit: input.cashRefund,
      credit: 0,
      memo: `Reverse executed refund cash for approval #${input.approvalRequestId}`,
    });
  }
  if (input.receivableReduction > 0) {
    lines.push({
      accountId: requiredAccountId(mappings.accounts_receivable, 'accounts_receivable'),
      debit: input.receivableReduction,
      credit: 0,
      memo: `Restore invoice receivable for approval #${input.approvalRequestId}`,
    });
  }
  for (const row of categoryDeltas) {
    lines.push({
      accountId: requiredAccountId((mappings as Record<string, number | undefined>)[row.key], row.key),
      debit: 0,
      credit: row.amount,
      memo: row.memo,
    });
  }
  if (otherRevenue > 0) {
    lines.push({
      accountId: requiredAccountId(mappings.other_revenue, 'other_revenue'),
      debit: 0,
      credit: otherRevenue,
      memo: 'Restore other revenue',
    });
  }
  const debit = money(lines.reduce((sum, row) => sum + row.debit, 0));
  const credit = money(lines.reduce((sum, row) => sum + row.credit, 0));
  if (debit !== input.totalRefund || credit !== input.totalRefund) {
    throw new Error('Executed refund reversal journal does not balance');
  }
  const sourceType = 'executed_refund_reversed';
  const sourceId = String(input.approvalRequestId);
  const sourceEventKey = createPostingEventKey(sourceType, sourceId, ACCOUNTING_EVENT_TYPES.manualJournal);
  return db.prepare(`
    INSERT OR IGNORE INTO accounting_posting_events (
      tenant_id, source_event_key, source_type, source_id,
      event_type, event_date, payload_json, created_by
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM approval_requests approval
      WHERE approval.tenant_id = ?
        AND approval.id = ?
        AND approval.status = 'rejected'
        AND approval.reviewed_by = ?
        AND approval.execution_status = 'succeeded'
    )
  `).bind(
    input.tenantId,
    sourceEventKey,
    sourceType,
    sourceId,
    ACCOUNTING_EVENT_TYPES.manualJournal,
    input.eventDate,
    JSON.stringify({ lines }),
    String(input.reviewerId),
    input.tenantId,
    input.approvalRequestId,
    input.reviewerId,
  ) as unknown as D1PreparedStatement;
}

export type ReverseExecutedRefundInput = {
  db: D1Database;
  tenantId: string;
  request: Record<string, unknown>;
  reviewerId: number;
  reason: string;
  cashResolution?: ExecutedRefundCashResolution;
  cashReturnedAcknowledged?: true;
  idempotencyKey?: string;
  reversedAtUtc?: string;
  businessDate?: string;
};

export type ReverseExecutedRefundResult = {
  approvalRequestId: number;
  cashResolution: ExecutedRefundCashResolution;
  cashHoldStatus: 'settled' | 'disputed';
  financialState: 'refund_reversed_cash_returned' | 'refund_reversed_disputed';
  canonicalRefundPublicId: string;
  canonicalReversalPublicId: string;
  disputeStatus: 'not_required' | 'open';
  executionMode: 'legacy' | 'strict' | 'shadow';
};

export async function reverseExecutedRefund(
  input: ReverseExecutedRefundInput,
): Promise<ReverseExecutedRefundResult> {
  const db = input.db;
  const tenantId = requiredText(input.tenantId, 'tenantId');
  const approvalRequestId = positiveInteger(Number(input.request.id), 'approvalRequestId');
  const billId = positiveInteger(Number(input.request.entity_id), 'billId');
  const requesterUserId = positiveInteger(Number(input.request.requested_by), 'requesterUserId');
  const reviewerId = positiveInteger(input.reviewerId, 'reviewerId');
  const reason = requiredText(input.reason, 'reason');
  if (!isExecutedPendingApproval({ ...input.request, type: 'refund' })) {
    throw new Error('Refund is not an executed-pending approval');
  }
  const resolution = resolveExecutedRefundRejection(input);
  const requestData = parseData(input.request.request_data);
  const originalBill = storedBillSnapshot(requestData.originalBill, 'originalBill');
  const refundedBill = storedBillSnapshot(requestData.refundedBill, 'refundedBill');
  const totalRefund = money(Number(requestData.requestedRefundAmount ?? 0));
  const cashRefund = money(Number(requestData.cashRefundAmount ?? 0));
  const receivableReduction = money(Number(requestData.receivableReduction ?? 0));
  if (totalRefund <= 0 || cashRefund <= 0 || money(cashRefund + receivableReduction) !== totalRefund) {
    throw new Error('Executed refund amounts do not reconcile');
  }
  if (money(originalBill.total - refundedBill.total) !== totalRefund) {
    throw new Error('Executed refund bill snapshots do not reconcile');
  }
  const creditNoteNo = requiredText(String(requestData.creditNoteNo ?? ''), 'creditNoteNo');
  const hold = await loadRefundCashHold(db, tenantId, approvalRequestId);
  if (!hold || hold.status !== 'consumed') {
    throw new Error('Executed refund consumed cash hold was not found');
  }
  if (hold.billId !== billId || money(hold.amount) !== cashRefund) {
    throw new Error('Executed refund cash hold does not reconcile');
  }

  let cashReturnDestination: { counterSessionId: number; counterId: number; employeeId: number } | null = null;
  if (resolution.cashResolution === 'cash_returned') {
    const counterSessionId = positiveInteger(Number(requestData.counterSessionId), 'counterSessionId');
    const counterId = positiveInteger(Number(requestData.counterId), 'counterId');
    const eligibleSessions = await loadEligibleExecutedRefundCashReturnSessions(db, tenantId, [{
      counterSessionId,
      counterId,
      employeeId: hold.employeeId,
    }]);
    const eligibleSession = eligibleSessions.get(counterSessionId);
    if (!eligibleSession
      || eligibleSession.counterId !== counterId
      || eligibleSession.employeeId !== hold.employeeId) {
      throw new Error('Returned cash requires the original eligible counter session to be active');
    }
    cashReturnDestination = {
      counterSessionId,
      counterId,
      employeeId: hold.employeeId,
    };
  }

  const reversedAtUtc = input.reversedAtUtc ?? new Date().toISOString();
  const businessDate = input.businessDate ?? getTodayGMT6();
  const canonicalRefundPublicId = await createDeterministicSourceId(
    'crrefund',
    tenantId,
    'legacy_live_credit_note_cash_refund',
    creditNoteNo,
  );
  const canonicalReversalPublicId = await createDeterministicSourceId(
    'crfrv',
    tenantId,
    'legacy_live_credit_note_cash_refund_reversal',
    String(approvalRequestId),
  );
  const cashHoldStatus = resolution.cashResolution === 'cash_returned' ? 'settled' : 'disputed';
  const disputeStatus = resolution.cashResolution === 'cash_returned' ? 'not_required' : 'open';
  const financialState = resolution.cashResolution === 'cash_returned'
    ? 'refund_reversed_cash_returned'
    : 'refund_reversed_disputed';
  const nextRequestData = {
    ...requestData,
    financialState,
    cashHoldStatus,
    disputeStatus,
    cashResolution: resolution.cashResolution,
    cashReturnedAcknowledged: resolution.cashReturnedAcknowledged,
    rejectionIdempotencyKey: resolution.idempotencyKey,
    canonicalRefundPublicId,
    canonicalReversalPublicId,
    reversedAtUtc,
    rejectionReason: reason,
  };
  const operationKey = `executed-refund-reversal:${approvalRequestId}`;
  const accountingStatement = await prepareExecutedRefundReversalAccountingEvent(db, {
    tenantId,
    approvalRequestId,
    reviewerId,
    eventDate: businessDate,
    totalRefund,
    cashRefund,
    receivableReduction,
    originalBill,
    refundedBill,
  });
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      UPDATE approval_requests
      SET status = 'rejected',
          reviewed_by = ?,
          reviewed_at = datetime('now', '+6 hours'),
          review_notes = ?,
          request_data = ?
      WHERE tenant_id = ?
        AND id = ?
        AND status IN ('pending', 'partially_approved')
        AND execution_status = 'succeeded'
        AND json_extract(request_data, '$.executionMode') = 'executed_pending'
        AND COALESCE(json_extract(request_data, '$.rejectionIdempotencyKey'), '') = ''
    `).bind(
      reviewerId,
      reason,
      JSON.stringify(nextRequestData),
      tenantId,
      approvalRequestId,
    ),
    prepareRefundBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey: 'approval-rejected',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE bills
      SET total = ?, paid = ?, due = ?, status = ?,
          test_bill = ?, doctor_visit_bill = ?, admission_bill = ?,
          operation_bill = ?, medicine_bill = ?
      WHERE tenant_id = ?
        AND id = ?
        AND ABS(total - ?) < 0.001
        AND ABS(paid - ?) < 0.001
        AND ABS(due - ?) < 0.001
        AND status = ?
        AND ABS(COALESCE(test_bill, 0) - ?) < 0.001
        AND ABS(COALESCE(doctor_visit_bill, 0) - ?) < 0.001
        AND ABS(COALESCE(admission_bill, 0) - ?) < 0.001
        AND ABS(COALESCE(operation_bill, 0) - ?) < 0.001
        AND ABS(COALESCE(medicine_bill, 0) - ?) < 0.001
    `).bind(
      originalBill.total,
      originalBill.paid,
      originalBill.due,
      originalBill.status,
      originalBill.testBill,
      originalBill.doctorVisitBill,
      originalBill.admissionBill,
      originalBill.operationBill,
      originalBill.medicineBill,
      tenantId,
      billId,
      refundedBill.total,
      refundedBill.paid,
      refundedBill.due,
      refundedBill.status,
      refundedBill.testBill,
      refundedBill.doctorVisitBill,
      refundedBill.admissionBill,
      refundedBill.operationBill,
      refundedBill.medicineBill,
    ),
    prepareRefundBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey: 'bill-restored',
      expectedChanges: 1,
    }),
    db.prepare(`
      UPDATE billing_credit_notes
      SET status = 'reversed',
          is_active = 0,
          remarks = COALESCE(remarks, '') || ?,
          approved_by = ?,
          approved_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND bill_id = ?
        AND credit_note_no = ?
        AND status = 'approved'
        AND COALESCE(is_active, 1) = 1
        AND ABS(total_amount - ?) < 0.001
        AND ABS(refund_amount - ?) < 0.001
    `).bind(
      ` | Reversed after approval rejection #${approvalRequestId}: ${reason}`,
      reviewerId,
      tenantId,
      billId,
      creditNoteNo,
      totalRefund,
      cashRefund,
    ),
    prepareRefundBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey: 'credit-note-reversed',
      expectedChanges: 1,
    }),
    accountingStatement,
    prepareRefundBatchAssertion(db, {
      tenantId,
      operationKey,
      stepKey: 'accounting-reversal',
      expectedChanges: 1,
    }),
    ...buildRestoreExecutedRefundCommissionStatements(db, {
      tenantId,
      approvalRequestId,
      creditNoteNo,
      userId: reviewerId,
      eventDate: businessDate,
      reason,
      rows: commissionSnapshots(requestData.commissionImpactRows),
    }),
  ];

  if (resolution.cashResolution === 'cash_returned' && cashReturnDestination) {
    const cashInput = {
      tenantId,
      holdId: hold.id,
      approvalRequestId,
      amount: cashRefund,
      reviewerId,
      destination: cashReturnDestination,
      idempotencyKey: resolution.idempotencyKey,
      reason,
    };
    statements.push(
      prepareCreditReturnedExecutedRefundCash(db, cashInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey,
        stepKey: 'cash-returned',
        expectedChanges: 1,
      }),
      prepareSettleExecutedRefundHold(db, cashInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey,
        stepKey: 'hold-settled',
        expectedChanges: 1,
      }),
    );
  } else {
    const disputeInput: OpenRefundDisputeInput = {
      tenantId,
      holdId: hold.id,
      approvalRequestId,
      billId,
      requesterUserId,
      amount: cashRefund,
      requesterCounterId: hold.counterId,
      requesterCounterSessionId: hold.counterSessionId,
      requesterEmployeeId: hold.employeeId,
      custodyUserId: hold.custodyUserId,
      rejectedBy: reviewerId,
      reason,
    };
    const disputeAccounting = await prepareExecutedRefundDisputeOpenedAccountingEvent(db, {
      ...disputeInput,
      eventDate: businessDate,
    });
    statements.push(
      prepareCreateExecutedRefundDispute(db, disputeInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey,
        stepKey: 'dispute-opened',
        expectedChanges: 1,
      }),
      disputeAccounting,
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey,
        stepKey: 'dispute-accounting',
        expectedChanges: 1,
      }),
      prepareMarkExecutedRefundHoldDisputed(db, disputeInput),
      prepareRefundBatchAssertion(db, {
        tenantId,
        operationKey,
        stepKey: 'hold-disputed',
        expectedChanges: 1,
      }),
    );
  }
  statements.push(prepareClearRefundBatchAssertions(db, tenantId, operationKey));

  const execution = await executeStrictFinancialMutation({
    db,
    tenantId,
    boundary: 'credit-note.cash-refund.reverse',
    legacyStatements: statements,
    strictAuthoritativeStatements: statements,
    canonical: async (options) => {
      const custody = resolution.cashResolution === 'cash_returned' && cashReturnDestination
        ? await prepareLiveCashCustodyMovement(db, {
            tenantId,
            custodyType: 'counter_session',
            legacyCounterId: cashReturnDestination.counterId,
            legacyCounterSessionId: cashReturnDestination.counterSessionId,
            movementType: 'adjustment',
            direction: 'in',
            amount: cashRefund,
            occurredAtUtc: reversedAtUtc,
            businessDate,
            sourceType: 'legacy_executed_refund_cash_return',
            sourcePublicId: `approval:${approvalRequestId}:hold:${hold.id}:${resolution.idempotencyKey}`,
            sourceTable: 'cash_drawer_movements',
            evidence: {
              approvalRequestId,
              holdId: hold.id,
              reviewerId,
              destinationEmployeeId: cashReturnDestination.employeeId,
              financialState,
            },
          })
        : null;
      const canonicalInput = await resolveLiveCreditNoteCashRefundReversal(db, {
        tenantId,
        refundPublicId: canonicalRefundPublicId,
        approvalRequestId,
        actorUserId: reviewerId,
        reasonCode: 'approval_rejected',
        reversedAtUtc,
        businessDate,
      });
      return reverseCreditNoteCashRefund(db, canonicalInput, {
        authoritativeStatements: [
          ...(options.authoritativeStatements ?? []),
          ...(custody?.statements ?? []),
        ],
      });
    },
  });

  const [storedRequest, storedHold, storedDispute] = await Promise.all([
    db.prepare(`
      SELECT status, execution_status, request_data
      FROM approval_requests
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(tenantId, approvalRequestId).first<{
      status: string;
      execution_status: string;
      request_data: string;
    }>(),
    loadRefundCashHold(db, tenantId, approvalRequestId),
    db.prepare(`
      SELECT status
      FROM billing_refund_cash_disputes
      WHERE tenant_id = ? AND approval_request_id = ?
      LIMIT 1
    `).bind(tenantId, approvalRequestId).first<{ status: string }>(),
  ]);
  if (!storedRequest || storedRequest.status !== 'rejected' || storedRequest.execution_status !== 'succeeded') {
    throw new Error('Executed refund rejection could not be verified');
  }
  const storedData = parseData(storedRequest.request_data);
  if (storedData.rejectionIdempotencyKey !== resolution.idempotencyKey || storedData.financialState !== financialState) {
    throw new Error('Executed refund rejection state could not be verified');
  }
  if (!storedHold || storedHold.status !== cashHoldStatus) {
    throw new Error('Executed refund cash resolution could not be verified');
  }
  if (resolution.cashResolution === 'open_dispute' && storedDispute?.status !== 'open') {
    throw new Error('Executed refund dispute could not be verified');
  }
  if (resolution.cashResolution === 'cash_returned' && storedDispute) {
    throw new Error('Cash-returned refund cannot also remain disputed');
  }

  return {
    approvalRequestId,
    cashResolution: resolution.cashResolution,
    cashHoldStatus,
    financialState,
    canonicalRefundPublicId,
    canonicalReversalPublicId,
    disputeStatus,
    executionMode: execution.mode,
  };
}
