import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { RefundAllocatedItem } from './billing-refund';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
} from './accounting-posting';
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

function money(value: number): number {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

export type CommissionRefundCalculationInput = {
  commissionBaseAmount: number;
  commissionRateBps: number;
  commissionFlatAmount: number;
  earnedCommissionAmount: number;
  doctorWaiverAmount: number;
  payableCommissionAmount: number;
  paidAmount: number;
  allocatedRefundAmount: number;
  itemRefundableBalance: number;
};

export type CommissionRefundCalculation = {
  newCommissionBaseAmount: number;
  newEarnedCommissionAmount: number;
  newDoctorWaiverAmount: number;
  newPayableCommissionAmount: number;
  newBalanceAmount: number;
  reversalAmount: number;
  blockedReason: string | null;
};

export function calculateCommissionRefundImpact(
  input: CommissionRefundCalculationInput,
): CommissionRefundCalculation {
  const oldBase = money(Math.max(0, Number(input.commissionBaseAmount || 0)));
  const oldEarned = money(Math.max(0, Number(input.earnedCommissionAmount || 0)));
  const oldWaiver = money(Math.max(0, Number(input.doctorWaiverAmount || 0)));
  const oldPayable = money(Math.max(0, Number(input.payableCommissionAmount || 0)));
  const paid = money(Math.max(0, Number(input.paidAmount || 0)));
  const allocation = money(Math.max(0, Number(input.allocatedRefundAmount || 0)));
  const itemBalance = money(Math.max(0, Number(input.itemRefundableBalance || 0)));
  const rateBps = Math.max(0, Number(input.commissionRateBps || 0));
  const flatAmount = money(Math.max(0, Number(input.commissionFlatAmount || 0)));

  const baseReduction = Math.min(oldBase, allocation);
  const newCommissionBaseAmount = money(Math.max(0, oldBase - baseReduction));
  let newEarnedCommissionAmount: number;
  if (rateBps > 0) {
    const earnedReduction = money(Math.min(oldEarned, baseReduction * rateBps / 10_000));
    newEarnedCommissionAmount = money(Math.max(0, oldEarned - earnedReduction));
  } else if (flatAmount > 0 || oldEarned > 0) {
    const ratio = itemBalance > 0 ? Math.min(1, allocation / itemBalance) : 0;
    newEarnedCommissionAmount = money(Math.max(0, oldEarned * (1 - ratio)));
  } else {
    newEarnedCommissionAmount = 0;
  }

  const newDoctorWaiverAmount = money(Math.min(oldWaiver, newEarnedCommissionAmount));
  const newPayableCommissionAmount = money(Math.max(0, newEarnedCommissionAmount - newDoctorWaiverAmount));
  const reversalAmount = money(Math.max(0, oldPayable - newPayableCommissionAmount));
  const newBalanceAmount = money(Math.max(0, newPayableCommissionAmount - paid));
  const blockedReason = paid > newPayableCommissionAmount
    ? `Commission already paid (${paid}) exceeds recomputed payable (${newPayableCommissionAmount})`
    : null;

  return {
    newCommissionBaseAmount,
    newEarnedCommissionAmount,
    newDoctorWaiverAmount,
    newPayableCommissionAmount,
    newBalanceAmount,
    reversalAmount,
    blockedReason,
  };
}

type CommissionAccrualRow = {
  id: number;
  doctor_id: number;
  doctor_name: string | null;
  patient_id: number | null;
  visit_id: number | null;
  bill_id: number;
  lab_order_item_id: number | null;
  canonical_source_key: string | null;
  source_type: string;
  gross_amount: number;
  commission_base_amount: number;
  commission_rate_bps: number;
  commission_flat_amount: number;
  commission_amount: number;
  earned_commission_amount: number;
  doctor_waiver_amount: number;
  payable_commission_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: string;
  accrued_date: string | null;
};

export type RefundCommissionImpactRow = CommissionRefundCalculation & {
  accrualId: number;
  legacyAccrualSourceKey: string | null;
  doctorId: number;
  doctorName: string;
  invoiceItemId: number;
  itemDescription: string;
  sourceType: string;
  oldCommissionBaseAmount: number;
  oldEarnedCommissionAmount: number;
  oldPayableCommissionAmount: number;
  paidAmount: number;
  patientId: number | null;
  visitId: number | null;
  accruedDate: string | null;
  grossAmount: number;
};

export type RefundCommissionImpactPreview = {
  rows: RefundCommissionImpactRow[];
  totalReversal: number;
  blocked: boolean;
  blockedReasons: string[];
};

function sourcePrefix(billId: number, allocation: RefundAllocatedItem): string {
  return `bill:${billId}:line:${allocation.lineIndex}:${allocation.itemCategory}:${allocation.referenceId ?? 'none'}:`;
}

function resolvedCommissionAmounts(row: CommissionAccrualRow): {
  base: number;
  earned: number;
  waiver: number;
  payable: number;
} {
  const hasReconciled = Number(row.earned_commission_amount ?? 0) !== 0
    || Number(row.doctor_waiver_amount ?? 0) !== 0
    || Number(row.payable_commission_amount ?? 0) !== 0;
  return {
    base: money(Number(row.commission_base_amount ?? 0) > 0
      ? Number(row.commission_base_amount)
      : Number(row.gross_amount ?? 0)),
    earned: money(hasReconciled ? Number(row.earned_commission_amount ?? 0) : Number(row.commission_amount ?? 0)),
    waiver: money(hasReconciled ? Number(row.doctor_waiver_amount ?? 0) : 0),
    payable: money(hasReconciled ? Number(row.payable_commission_amount ?? 0) : Number(row.commission_amount ?? 0)),
  };
}

async function loadBillCommissionAccruals(
  db: D1Database,
  tenantId: string,
  billId: number,
): Promise<CommissionAccrualRow[]> {
  const { results } = await db.prepare(`
    SELECT
      dca.id, dca.doctor_id, d.name AS doctor_name,
      dca.patient_id, dca.visit_id, dca.bill_id, dca.lab_order_item_id,
      dca.canonical_source_key, dca.source_type, dca.gross_amount,
      dca.commission_base_amount, dca.commission_rate_bps,
      dca.commission_flat_amount, dca.commission_amount,
      dca.earned_commission_amount, dca.doctor_waiver_amount,
      dca.payable_commission_amount, dca.paid_amount,
      dca.balance_amount, dca.status, dca.accrued_date
    FROM doctor_commission_accruals dca
    LEFT JOIN doctors d
      ON d.id = dca.doctor_id
     AND d.tenant_id = dca.tenant_id
    WHERE dca.tenant_id = ?
      AND dca.bill_id = ?
      AND COALESCE(dca.status, 'accrued') != 'cancelled'
    ORDER BY dca.id
  `).bind(tenantId, billId).all<CommissionAccrualRow>();
  return results ?? [];
}

export async function previewRefundCommissionImpact(
  db: D1Database,
  input: {
    tenantId: string;
    billId: number;
    allocations: RefundAllocatedItem[];
  },
): Promise<RefundCommissionImpactPreview> {
  const accruals = await loadBillCommissionAccruals(db, input.tenantId, input.billId);
  const rows: RefundCommissionImpactRow[] = [];

  for (const allocation of input.allocations) {
    if (allocation.allocatedRefundAmount <= 0) continue;
    const prefix = sourcePrefix(input.billId, allocation);
    const matched = accruals.filter((row) => String(row.canonical_source_key ?? '').startsWith(prefix));
    for (const accrual of matched) {
      const amounts = resolvedCommissionAmounts(accrual);
      const calculation = calculateCommissionRefundImpact({
        commissionBaseAmount: amounts.base,
        commissionRateBps: Number(accrual.commission_rate_bps ?? 0),
        commissionFlatAmount: Number(accrual.commission_flat_amount ?? 0),
        earnedCommissionAmount: amounts.earned,
        doctorWaiverAmount: amounts.waiver,
        payableCommissionAmount: amounts.payable,
        paidAmount: Number(accrual.paid_amount ?? 0),
        allocatedRefundAmount: allocation.allocatedRefundAmount,
        itemRefundableBalance: allocation.refundableBalance,
      });
      rows.push({
        ...calculation,
        accrualId: Number(accrual.id),
        legacyAccrualSourceKey: accrual.canonical_source_key,
        doctorId: Number(accrual.doctor_id),
        doctorName: String(accrual.doctor_name || `Doctor #${accrual.doctor_id}`),
        invoiceItemId: allocation.invoiceItemId,
        itemDescription: allocation.description,
        sourceType: String(accrual.source_type),
        oldCommissionBaseAmount: amounts.base,
        oldEarnedCommissionAmount: amounts.earned,
        oldPayableCommissionAmount: amounts.payable,
        paidAmount: money(Number(accrual.paid_amount ?? 0)),
        patientId: accrual.patient_id == null ? null : Number(accrual.patient_id),
        visitId: accrual.visit_id == null ? null : Number(accrual.visit_id),
        accruedDate: accrual.accrued_date ?? null,
        grossAmount: money(Number(accrual.gross_amount ?? 0)),
      });
    }
  }

  const blockedReasons = rows.flatMap((row) => row.blockedReason ? [
    `${row.doctorName} / accrual #${row.accrualId}: ${row.blockedReason}`,
  ] : []);
  return {
    rows,
    totalReversal: money(rows.reduce((sum, row) => sum + row.reversalAmount, 0)),
    blocked: blockedReasons.length > 0,
    blockedReasons,
  };
}

export type ApplyRefundCommissionImpactInput = {
  tenantId: string;
  billId: number;
  allocations: RefundAllocatedItem[];
  creditNoteId: number | null;
  creditNoteNo: string;
  userId: string | number;
  eventDate: string;
  reason: string;
};

export async function buildRefundCommissionImpactStatements(
  db: D1Database,
  input: ApplyRefundCommissionImpactInput,
  preview: RefundCommissionImpactPreview,
): Promise<D1PreparedStatement[]> {
  if (preview.blocked) throw new Error(preview.blockedReasons.join('; '));
  const operationKey = `refund-commission-impact:${input.creditNoteNo}`;
  const statements: D1PreparedStatement[] = [];
  for (const row of preview.rows) {
    if (row.reversalAmount <= 0) continue;
    const sourceId = `${input.creditNoteNo}:${row.accrualId}`;
    const sourceEventKey = createPostingEventKey(
      'doctor_commission_refund_adjustment',
      sourceId,
      ACCOUNTING_EVENT_TYPES.commissionCancelled,
    );
    const existing = await db.prepare(`
      SELECT id
      FROM accounting_posting_events
      WHERE tenant_id = ? AND source_event_key = ?
      LIMIT 1
    `).bind(input.tenantId, sourceEventKey).first<{ id: number }>();
    if (existing) continue;

    const nextStatus = row.newPayableCommissionAmount <= 0 && row.paidAmount <= 0 ? 'cancelled' : 'accrued';
    statements.push(
      db.prepare(`
        UPDATE doctor_commission_accruals
        SET commission_base_amount = ?,
            earned_commission_amount = ?,
            doctor_waiver_amount = ?,
            payable_commission_amount = ?,
            commission_amount = ?,
            balance_amount = ?,
            status = ?,
            notes = COALESCE(notes, '') || ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND bill_id = ?
          AND COALESCE(status, 'accrued') != 'cancelled'
          AND COALESCE(paid_amount, 0) <= ?
      `).bind(
        row.newCommissionBaseAmount,
        row.newEarnedCommissionAmount,
        row.newDoctorWaiverAmount,
        row.newPayableCommissionAmount,
        row.newPayableCommissionAmount,
        row.newBalanceAmount,
        nextStatus,
        ` | Refund ${input.creditNoteNo}: -${row.reversalAmount} (${input.reason})`,
        input.tenantId,
        row.accrualId,
        input.billId,
        row.newPayableCommissionAmount,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `accrual:${row.accrualId}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events (
          tenant_id, source_event_key, source_type, source_id,
          event_type, event_date, payload_json, created_by
        ) VALUES (?, ?, 'doctor_commission_refund_adjustment', ?, ?, ?, ?, ?)
      `).bind(
        input.tenantId,
        sourceEventKey,
        sourceId,
        ACCOUNTING_EVENT_TYPES.commissionCancelled,
        input.eventDate,
        JSON.stringify({
          accrualId: row.accrualId,
          doctorId: row.doctorId,
          patientId: row.patientId,
          visitId: row.visitId,
          billId: input.billId,
          creditNoteId: input.creditNoteId,
          creditNoteNo: input.creditNoteNo,
          invoiceItemId: row.invoiceItemId,
          commissionSourceType: row.sourceType,
          grossAmount: row.grossAmount,
          amount: row.reversalAmount,
          oldPayableAmount: row.oldPayableCommissionAmount,
          newPayableAmount: row.newPayableCommissionAmount,
          reason: input.reason,
        }),
        String(input.userId),
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `accounting:${row.accrualId}`,
        expectedChanges: 1,
      }),
    );
  }
  if (statements.length > 0) {
    statements.push(prepareClearRefundBatchAssertions(db, input.tenantId, operationKey));
  }

  return statements;
}

type RefundCommissionImpactCommandResult = {
  billId: number;
  creditNoteId: number | null;
  creditNoteNo: string;
  totalReversal: number;
  affectedAccrualIds: number[];
};

export async function applyRefundCommissionImpact(
  db: D1Database,
  input: ApplyRefundCommissionImpactInput,
): Promise<RefundCommissionImpactPreview> {
  const canonicalDb = db as unknown as CanonicalBatchDatabase;
  const commandName = 'canonical.refund_commission.impact';
  const idempotencyKey = `refund-commission-impact:${input.creditNoteNo}`;
  const request = {
    billId: input.billId,
    allocations: input.allocations,
    creditNoteId: input.creditNoteId,
    creditNoteNo: input.creditNoteNo,
    userId: String(input.userId),
    eventDate: input.eventDate,
    reason: input.reason,
  };
  const replay = await readCanonicalCommandReplay<RefundCommissionImpactCommandResult>(canonicalDb, {
    tenantId: input.tenantId,
    commandName,
    idempotencyKey,
    request,
  });
  if (replay) {
    return {
      rows: [],
      totalReversal: replay.result.totalReversal,
      blocked: false,
      blockedReasons: [],
    };
  }

  const preview = await previewRefundCommissionImpact(db, input);
  const refundStatements = await buildRefundCommissionImpactStatements(db, input, preview);
  const guardedRowCount = refundStatements.length > 0
    ? (refundStatements.length - 1) / 4
    : 0;
  if (!Number.isSafeInteger(guardedRowCount) || guardedRowCount < 0) {
    throw new Error('Refund commission statement composition is not deterministic');
  }
  const operationKey = idempotencyKey;
  const statements: D1PreparedStatement[] = [...refundStatements];
  if (guardedRowCount > 0) {
    statements.push(
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: 'refund-guard-cleared',
        expectedChanges: guardedRowCount * 2,
      }),
      prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey),
    );
  }

  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'refund_commission_impact',
    billId: input.billId,
    creditNoteId: input.creditNoteId,
    creditNoteNo: input.creditNoteNo,
    affectedAccrualIds: preview.rows
      .filter((row) => row.reversalAmount > 0)
      .map((row) => row.accrualId)
      .sort((a, b) => a - b),
    totalReversal: preview.totalReversal,
    eventDate: input.eventDate,
  });
  const result: RefundCommissionImpactCommandResult = {
    billId: input.billId,
    creditNoteId: input.creditNoteId,
    creditNoteNo: input.creditNoteNo,
    totalReversal: preview.totalReversal,
    affectedAccrualIds: preview.rows
      .filter((row) => row.reversalAmount > 0)
      .map((row) => row.accrualId)
      .sort((a, b) => a - b),
  };
  const occurredAtUtc = new Date().toISOString();
  await runCanonicalBatch(canonicalDb, {
    tenantId: input.tenantId,
    commandName,
    idempotencyKey,
    request,
    statements: statements as unknown as readonly CanonicalPreparedStatement[],
    result,
    event: {
      eventPublicId: await createDeterministicSourceId(
        'outevt',
        input.tenantId,
        'refund_commission_impact',
        input.creditNoteNo,
      ),
      aggregateType: 'refund_commission_impact',
      aggregatePublicId: input.creditNoteNo,
      eventType: 'canonical.refund_commission.impact_recorded',
      occurredAtUtc,
      businessDate: input.eventDate,
      payload: {
        ...result,
        guardedRowCount,
        sourceEvidenceSha256,
      },
    },
  });
  return preview;
}

export type ExecutedRefundCommissionImpactSnapshot = {
  accrualId: number;
  billId: number;
  oldCommissionBaseAmount: number;
  oldEarnedCommissionAmount: number;
  oldDoctorWaiverAmount: number;
  oldPayableCommissionAmount: number;
  oldBalanceAmount: number;
  newCommissionBaseAmount: number;
  newEarnedCommissionAmount: number;
  newDoctorWaiverAmount: number;
  newPayableCommissionAmount: number;
  newBalanceAmount: number;
  paidAmount: number;
  reversalAmount: number;
};

export function buildRestoreExecutedRefundCommissionStatements(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestId: number;
    creditNoteNo: string;
    userId: string | number;
    eventDate: string;
    reason: string;
    rows: readonly ExecutedRefundCommissionImpactSnapshot[];
  },
): D1PreparedStatement[] {
  const operationKey = `executed-refund-commission-restore:${input.approvalRequestId}`;
  const statements: D1PreparedStatement[] = [];
  for (const row of input.rows) {
    if (!Number.isInteger(row.accrualId) || row.accrualId <= 0 || row.reversalAmount <= 0) continue;
    const sourceId = `${input.creditNoteNo}:${row.accrualId}:reversal`;
    const sourceEventKey = createPostingEventKey(
      'doctor_commission_refund_reversal',
      sourceId,
      ACCOUNTING_EVENT_TYPES.commissionAccrued,
    );
    statements.push(
      db.prepare(`
        UPDATE doctor_commission_accruals
        SET commission_base_amount = ?,
            earned_commission_amount = ?,
            doctor_waiver_amount = ?,
            payable_commission_amount = ?,
            commission_amount = ?,
            balance_amount = ?,
            status = 'accrued',
            notes = COALESCE(notes, '') || ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND bill_id = ?
          AND ABS(commission_base_amount - ?) < 0.001
          AND ABS(earned_commission_amount - ?) < 0.001
          AND ABS(doctor_waiver_amount - ?) < 0.001
          AND ABS(payable_commission_amount - ?) < 0.001
          AND ABS(balance_amount - ?) < 0.001
          AND ABS(COALESCE(paid_amount, 0) - ?) < 0.001
      `).bind(
        row.oldCommissionBaseAmount,
        row.oldEarnedCommissionAmount,
        row.oldDoctorWaiverAmount,
        row.oldPayableCommissionAmount,
        row.oldPayableCommissionAmount,
        row.oldBalanceAmount,
        ` | Rejected refund ${input.creditNoteNo} reversed: +${row.reversalAmount} (${input.reason})`,
        input.tenantId,
        row.accrualId,
        row.billId,
        row.newCommissionBaseAmount,
        row.newEarnedCommissionAmount,
        row.newDoctorWaiverAmount,
        row.newPayableCommissionAmount,
        row.newBalanceAmount,
        row.paidAmount,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `restore-accrual:${row.accrualId}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events (
          tenant_id, source_event_key, source_type, source_id,
          event_type, event_date, payload_json, created_by
        ) VALUES (?, ?, 'doctor_commission_refund_reversal', ?, ?, ?, ?, ?)
      `).bind(
        input.tenantId,
        sourceEventKey,
        sourceId,
        ACCOUNTING_EVENT_TYPES.commissionAccrued,
        input.eventDate,
        JSON.stringify({
          approvalRequestId: input.approvalRequestId,
          billId: row.billId,
          accrualId: row.accrualId,
          creditNoteNo: input.creditNoteNo,
          amount: row.reversalAmount,
          restoredPayableAmount: row.oldPayableCommissionAmount,
          reason: input.reason,
        }),
        String(input.userId),
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `restore-accounting:${row.accrualId}`,
        expectedChanges: 1,
      }),
    );
  }
  if (statements.length > 0) {
    statements.push(prepareClearRefundBatchAssertions(db, input.tenantId, operationKey));
  }
  return statements;
}

type RefundCommissionReservationRow = {
  id: number;
  approval_request_id: number;
  refund_cash_hold_id: number;
  bill_id: number;
  accrual_id: number;
  invoice_item_id: number | null;
  allocated_refund_amount: number;
  commission_base_reduction: number;
  reserved_commission_amount: number;
  original_commission_base_amount: number;
  original_earned_commission_amount: number;
  original_doctor_waiver_amount: number;
  original_payable_commission_amount: number;
  original_balance_amount: number;
  reserved_commission_base_amount: number;
  reserved_earned_commission_amount: number;
  reserved_doctor_waiver_amount: number;
  reserved_payable_commission_amount: number;
  reserved_balance_amount: number;
  status: 'held' | 'consumed' | 'disputed' | 'released' | 'written_off';
  doctor_id: number;
  doctor_name: string | null;
  patient_id: number | null;
  visit_id: number | null;
  source_type: string;
  canonical_source_key: string | null;
  gross_amount: number;
  paid_amount: number;
  accrued_date: string | null;
  item_description: string | null;
};

export type RefundCommissionReservationPreview = RefundCommissionImpactPreview & {
  approvalRequestId: number;
  refundCashHoldId: number;
  status: RefundCommissionReservationRow['status'];
};

export async function loadRefundCommissionReservationPreview(
  db: D1Database,
  tenantId: string,
  approvalRequestId: number,
): Promise<RefundCommissionReservationPreview | null> {
  const { results } = await db.prepare(`
    SELECT
      reservation.*,
      accrual.doctor_id,
      doctor.name AS doctor_name,
      accrual.patient_id,
      accrual.visit_id,
      accrual.source_type,
      accrual.gross_amount,
      accrual.paid_amount,
      accrual.accrued_date,
      item.description AS item_description
    FROM billing_refund_commission_reservations reservation
    JOIN doctor_commission_accruals accrual
      ON accrual.tenant_id = reservation.tenant_id
     AND accrual.id = reservation.accrual_id
    LEFT JOIN doctors doctor
      ON doctor.tenant_id = accrual.tenant_id
     AND doctor.id = accrual.doctor_id
    LEFT JOIN invoice_items item
      ON item.tenant_id = reservation.tenant_id
     AND item.id = reservation.invoice_item_id
    WHERE reservation.tenant_id = ?
      AND reservation.approval_request_id = ?
    ORDER BY reservation.id
  `).bind(tenantId, approvalRequestId).all<RefundCommissionReservationRow>();
  if (!results || results.length === 0) return null;

  const rows: RefundCommissionImpactRow[] = results.map((row) => ({
    accrualId: Number(row.accrual_id),
    legacyAccrualSourceKey: null,
    doctorId: Number(row.doctor_id),
    doctorName: String(row.doctor_name || `Doctor #${row.doctor_id}`),
    invoiceItemId: Number(row.invoice_item_id ?? 0),
    itemDescription: String(row.item_description || `Invoice item #${row.invoice_item_id ?? 'unknown'}`),
    sourceType: String(row.source_type),
    oldCommissionBaseAmount: money(row.original_commission_base_amount),
    oldEarnedCommissionAmount: money(row.original_earned_commission_amount),
    oldPayableCommissionAmount: money(row.original_payable_commission_amount),
    paidAmount: money(row.paid_amount),
    patientId: row.patient_id == null ? null : Number(row.patient_id),
    visitId: row.visit_id == null ? null : Number(row.visit_id),
    accruedDate: row.accrued_date ?? null,
    grossAmount: money(row.gross_amount),
    newCommissionBaseAmount: money(row.reserved_commission_base_amount),
    newEarnedCommissionAmount: money(row.reserved_earned_commission_amount),
    newDoctorWaiverAmount: money(row.reserved_doctor_waiver_amount),
    newPayableCommissionAmount: money(row.reserved_payable_commission_amount),
    newBalanceAmount: money(row.reserved_balance_amount),
    reversalAmount: money(row.reserved_commission_amount),
    blockedReason: null,
  }));
  return {
    approvalRequestId: Number(results[0].approval_request_id),
    refundCashHoldId: Number(results[0].refund_cash_hold_id),
    status: results[0].status,
    rows,
    totalReversal: money(rows.reduce((sum, row) => sum + row.reversalAmount, 0)),
    blocked: false,
    blockedReasons: [],
  };
}

export type RefundCommissionReservationInput = {
  tenantId: string;
  billId: number;
  approvalRequestId?: number;
  refundCashHoldId?: number;
  refundRequestIdempotencyKey?: string;
  userId: string | number;
  eventDate: string;
  reason: string;
};

function reservationReference(input: RefundCommissionReservationInput): {
  approvalSql: string;
  approvalBindings: unknown[];
  holdSql: string;
  holdBindings: unknown[];
} {
  if (input.approvalRequestId != null && input.refundCashHoldId != null) {
    return {
      approvalSql: '?',
      approvalBindings: [input.approvalRequestId],
      holdSql: '?',
      holdBindings: [input.refundCashHoldId],
    };
  }
  const key = String(input.refundRequestIdempotencyKey ?? '').trim();
  if (!key) throw new Error('Refund commission reservation requires approval/hold IDs or an idempotency key');
  return {
    approvalSql: `(
      SELECT id
      FROM approval_requests
      WHERE tenant_id = ?
        AND type = 'refund'
        AND json_extract(request_data, '$.refundRequestIdempotencyKey') = ?
      ORDER BY id DESC
      LIMIT 1
    )`,
    approvalBindings: [input.tenantId, key],
    holdSql: `(
      SELECT id
      FROM billing_refund_cash_holds
      WHERE tenant_id = ?
        AND idempotency_key = ?
      ORDER BY id DESC
      LIMIT 1
    )`,
    holdBindings: [input.tenantId, key],
  };
}

export async function buildRefundCommissionReservationStatements(
  db: D1Database,
  input: RefundCommissionReservationInput,
  preview: RefundCommissionImpactPreview,
): Promise<D1PreparedStatement[]> {
  if (preview.blocked) throw new Error(preview.blockedReasons.join('; '));
  const reference = reservationReference(input);
  const operationKey = `refund-request:${input.approvalRequestId ?? input.refundRequestIdempotencyKey ?? input.billId}`;
  const statements: D1PreparedStatement[] = [];
  for (const row of preview.rows) {
    if (row.reversalAmount <= 0) continue;
    const sourceId = `approval:${input.approvalRequestId ?? input.refundRequestIdempotencyKey}:accrual:${row.accrualId}`;
    const sourceEventKey = createPostingEventKey(
      'doctor_commission_refund_reservation',
      sourceId,
      ACCOUNTING_EVENT_TYPES.commissionCancelled,
    );
    const nextStatus = row.newPayableCommissionAmount <= 0 && row.paidAmount <= 0 ? 'cancelled' : 'accrued';
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO billing_refund_commission_reservations (
          tenant_id, approval_request_id, refund_cash_hold_id, bill_id,
          accrual_id, invoice_item_id, allocated_refund_amount,
          commission_base_reduction, reserved_commission_amount,
          original_commission_base_amount, original_earned_commission_amount,
          original_doctor_waiver_amount, original_payable_commission_amount,
          original_balance_amount, reserved_commission_base_amount,
          reserved_earned_commission_amount, reserved_doctor_waiver_amount,
          reserved_payable_commission_amount, reserved_balance_amount,
          status, created_by
        )
        SELECT ?, ${reference.approvalSql}, ${reference.holdSql}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'held', ?
        WHERE EXISTS (
          SELECT 1
          FROM doctor_commission_accruals accrual
          WHERE accrual.tenant_id = ?
            AND accrual.id = ?
            AND accrual.bill_id = ?
            AND COALESCE(accrual.status, 'accrued') != 'cancelled'
            AND ABS(COALESCE(accrual.commission_base_amount, 0) - ?) < 0.001
            AND ABS(COALESCE(accrual.payable_commission_amount, accrual.commission_amount, 0) - ?) < 0.001
            AND COALESCE(accrual.paid_amount, 0) <= ?
        )
      `).bind(
        input.tenantId,
        ...reference.approvalBindings,
        ...reference.holdBindings,
        input.billId,
        row.accrualId,
        row.invoiceItemId,
        money(row.oldCommissionBaseAmount - row.newCommissionBaseAmount),
        money(row.oldCommissionBaseAmount - row.newCommissionBaseAmount),
        row.reversalAmount,
        row.oldCommissionBaseAmount,
        row.oldEarnedCommissionAmount,
        money(row.oldEarnedCommissionAmount - row.oldPayableCommissionAmount),
        row.oldPayableCommissionAmount,
        money(row.oldPayableCommissionAmount - row.paidAmount),
        row.newCommissionBaseAmount,
        row.newEarnedCommissionAmount,
        row.newDoctorWaiverAmount,
        row.newPayableCommissionAmount,
        row.newBalanceAmount,
        Number(input.userId),
        input.tenantId,
        row.accrualId,
        input.billId,
        row.oldCommissionBaseAmount,
        row.oldPayableCommissionAmount,
        row.newPayableCommissionAmount,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `reservation:${row.accrualId}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        UPDATE doctor_commission_accruals
        SET commission_base_amount = ?,
            earned_commission_amount = ?,
            doctor_waiver_amount = ?,
            payable_commission_amount = ?,
            commission_amount = ?,
            balance_amount = ?,
            status = ?,
            notes = COALESCE(notes, '') || ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND bill_id = ?
          AND ABS(COALESCE(commission_base_amount, 0) - ?) < 0.001
          AND ABS(COALESCE(payable_commission_amount, commission_amount, 0) - ?) < 0.001
          AND EXISTS (
            SELECT 1
            FROM billing_refund_commission_reservations reservation
            WHERE reservation.tenant_id = doctor_commission_accruals.tenant_id
              AND reservation.accrual_id = doctor_commission_accruals.id
              AND reservation.status = 'held'
          )
      `).bind(
        row.newCommissionBaseAmount,
        row.newEarnedCommissionAmount,
        row.newDoctorWaiverAmount,
        row.newPayableCommissionAmount,
        row.newPayableCommissionAmount,
        row.newBalanceAmount,
        nextStatus,
        ` | Refund commission held: -${row.reversalAmount} (${input.reason})`,
        input.tenantId,
        row.accrualId,
        input.billId,
        row.oldCommissionBaseAmount,
        row.oldPayableCommissionAmount,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `accrual:${row.accrualId}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events (
          tenant_id, source_event_key, source_type, source_id,
          event_type, event_date, payload_json, created_by
        )
        SELECT ?, ?, 'doctor_commission_refund_reservation', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM billing_refund_commission_reservations reservation
          JOIN doctor_commission_accruals accrual
            ON accrual.tenant_id = reservation.tenant_id
           AND accrual.id = reservation.accrual_id
          WHERE reservation.tenant_id = ?
            AND reservation.accrual_id = ?
            AND reservation.status = 'held'
            AND ABS(accrual.payable_commission_amount - reservation.reserved_payable_commission_amount) < 0.001
        )
      `).bind(
        input.tenantId,
        sourceEventKey,
        sourceId,
        ACCOUNTING_EVENT_TYPES.commissionCancelled,
        input.eventDate,
        JSON.stringify({
          approvalRequestId: input.approvalRequestId ?? null,
          refundRequestIdempotencyKey: input.refundRequestIdempotencyKey ?? null,
          billId: input.billId,
          accrualId: row.accrualId,
          doctorId: row.doctorId,
          invoiceItemId: row.invoiceItemId,
          allocatedRefundAmount: money(row.oldCommissionBaseAmount - row.newCommissionBaseAmount),
          amount: row.reversalAmount,
          oldPayableAmount: row.oldPayableCommissionAmount,
          reservedPayableAmount: row.newPayableCommissionAmount,
          reason: input.reason,
        }),
        String(input.userId),
        input.tenantId,
        row.accrualId,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `accounting:${row.accrualId}`,
        expectedChanges: 1,
      }),
    );
  }
  if (statements.length > 0) {
    statements.push(prepareClearRefundBatchAssertions(db, input.tenantId, operationKey));
  }
  return statements;
}

export function prepareTransitionRefundCommissionReservations(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestId: number;
    fromStatus: 'held' | 'disputed';
    toStatus: 'consumed' | 'disputed' | 'written_off';
    userId: string | number;
    reason: string;
  },
): D1PreparedStatement {
  return db.prepare(`
    UPDATE billing_refund_commission_reservations
    SET status = ?,
        resolved_by = ?,
        resolution_reason = ?,
        resolved_at = CASE WHEN ? IN ('consumed', 'written_off') THEN datetime('now', '+6 hours') ELSE resolved_at END,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND approval_request_id = ?
      AND status = ?
  `).bind(
    input.toStatus,
    Number(input.userId),
    input.reason,
    input.toStatus,
    input.tenantId,
    input.approvalRequestId,
    input.fromStatus,
  ) as unknown as D1PreparedStatement;
}

export function buildTransitionRefundCommissionReservationStatements(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestId: number;
    fromStatus: 'held' | 'disputed';
    toStatus: 'consumed' | 'disputed' | 'written_off';
    userId: string | number;
    reason: string;
    expectedChanges: number;
    operationKey: string;
  },
): D1PreparedStatement[] {
  if (!Number.isInteger(input.expectedChanges) || input.expectedChanges <= 0) {
    throw new Error('Refund commission transition requires a positive expected row count');
  }
  return [
    prepareTransitionRefundCommissionReservations(db, input),
    prepareRefundBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey: input.operationKey,
      stepKey: `commission:${input.fromStatus}->${input.toStatus}`,
      expectedChanges: input.expectedChanges,
    }),
  ];
}

export async function buildRestoreRefundCommissionReservationStatements(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestId: number;
    userId: string | number;
    eventDate: string;
    reason: string;
  },
): Promise<D1PreparedStatement[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM billing_refund_commission_reservations
    WHERE tenant_id = ?
      AND approval_request_id = ?
      AND status = 'disputed'
    ORDER BY id
  `).bind(input.tenantId, input.approvalRequestId).all<RefundCommissionReservationRow>();
  const operationKey = `refund-dispute-recovery:${input.approvalRequestId}`;
  const statements: D1PreparedStatement[] = [];
  for (const row of results ?? []) {
    const baseRestore = money(row.original_commission_base_amount - row.reserved_commission_base_amount);
    const earnedRestore = money(row.original_earned_commission_amount - row.reserved_earned_commission_amount);
    const waiverRestore = money(row.original_doctor_waiver_amount - row.reserved_doctor_waiver_amount);
    const payableRestore = money(row.original_payable_commission_amount - row.reserved_payable_commission_amount);
    const balanceRestore = money(row.original_balance_amount - row.reserved_balance_amount);
    const sourceId = `approval:${input.approvalRequestId}:accrual:${row.accrual_id}`;
    const sourceEventKey = createPostingEventKey(
      'doctor_commission_refund_reservation_release',
      sourceId,
      ACCOUNTING_EVENT_TYPES.commissionAccrued,
    );
    statements.push(
      db.prepare(`
        UPDATE doctor_commission_accruals
        SET commission_base_amount = ROUND(commission_base_amount + ?, 2),
            earned_commission_amount = ROUND(earned_commission_amount + ?, 2),
            doctor_waiver_amount = ROUND(doctor_waiver_amount + ?, 2),
            payable_commission_amount = ROUND(payable_commission_amount + ?, 2),
            commission_amount = ROUND(commission_amount + ?, 2),
            balance_amount = ROUND(balance_amount + ?, 2),
            status = 'accrued',
            notes = COALESCE(notes, '') || ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND EXISTS (
            SELECT 1
            FROM billing_refund_commission_reservations reservation
            WHERE reservation.tenant_id = doctor_commission_accruals.tenant_id
              AND reservation.id = ?
              AND reservation.status = 'disputed'
          )
      `).bind(
        baseRestore,
        earnedRestore,
        waiverRestore,
        payableRestore,
        payableRestore,
        balanceRestore,
        ` | Refund commission restored: +${payableRestore} (${input.reason})`,
        input.tenantId,
        row.accrual_id,
        row.id,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `restore-accrual:${row.accrual_id}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events (
          tenant_id, source_event_key, source_type, source_id,
          event_type, event_date, payload_json, created_by
        )
        SELECT ?, ?, 'doctor_commission_refund_reservation_release', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1
          FROM doctor_commission_accruals accrual
          WHERE accrual.tenant_id = ?
            AND accrual.id = ?
            AND ABS(accrual.payable_commission_amount - ?) < 0.001
        )
      `).bind(
        input.tenantId,
        sourceEventKey,
        sourceId,
        ACCOUNTING_EVENT_TYPES.commissionAccrued,
        input.eventDate,
        JSON.stringify({
          approvalRequestId: input.approvalRequestId,
          billId: row.bill_id,
          accrualId: row.accrual_id,
          invoiceItemId: row.invoice_item_id,
          amount: payableRestore,
          reason: input.reason,
        }),
        String(input.userId),
        input.tenantId,
        row.accrual_id,
        row.original_payable_commission_amount,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `restore-accounting:${row.accrual_id}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        UPDATE billing_refund_commission_reservations
        SET status = 'released',
            resolved_by = ?,
            resolution_reason = ?,
            resolved_at = datetime('now', '+6 hours'),
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id = ?
          AND status = 'disputed'
          AND EXISTS (
            SELECT 1
            FROM accounting_posting_events event
            WHERE event.tenant_id = billing_refund_commission_reservations.tenant_id
              AND event.source_event_key = ?
          )
      `).bind(
        Number(input.userId),
        input.reason,
        input.tenantId,
        row.id,
        sourceEventKey,
      ),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `release-reservation:${row.accrual_id}`,
        expectedChanges: 1,
      }),
    );
  }
  if ((results ?? []).length > 0) {
    statements.push(
      db.prepare(`
        UPDATE approval_requests
        SET request_data = json_set(request_data, '$.commissionReservationStatus', 'released')
        WHERE tenant_id = ? AND id = ?
      `).bind(input.tenantId, input.approvalRequestId),
      prepareRefundBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: 'release-request-data',
        expectedChanges: 1,
      }),
      prepareClearRefundBatchAssertions(db, input.tenantId, operationKey),
    );
  }
  return statements;
}

export type CreditNoteCommissionItem = {
  id?: number | null;
  invoice_item_id: number;
  return_quantity: number;
};

type CreditNoteCommissionAccrualRow = {
  id: number;
  doctor_id: number;
  bill_id: number;
  bill_item_id: number;
  persisted_bill_item_id: number | null;
  payable_commission_amount: number;
  paid_amount: number;
  balance_amount: number;
  original_quantity: number;
};

export type DoctorCommissionReturnAdjustment = {
  returnRatio: number;
  targetAdjustmentAmount: number;
  reversalAmount: number;
  clawbackAmount: number;
};

export function calculateDoctorCommissionReturnAdjustment(input: {
  payableCommissionAmount: number;
  balanceAmount: number;
  paidAmount: number;
  returnedQuantity: number;
  originalQuantity: number;
}): DoctorCommissionReturnAdjustment {
  const originalQuantity = Math.max(0, Number(input.originalQuantity ?? 0));
  const returnedQuantity = Math.max(0, Number(input.returnedQuantity ?? 0));
  const returnRatio = originalQuantity <= 0
    ? 0
    : Math.min(1, Math.round((returnedQuantity / originalQuantity) * 1_000_000) / 1_000_000);
  const targetAdjustmentAmount = money(Math.max(0, input.payableCommissionAmount) * returnRatio);
  const reversalAmount = money(Math.min(targetAdjustmentAmount, Math.max(0, input.balanceAmount)));
  const clawbackAmount = money(Math.min(
    targetAdjustmentAmount - reversalAmount,
    Math.max(0, input.paidAmount),
  ));

  return { returnRatio, targetAdjustmentAmount, reversalAmount, clawbackAmount };
}

export async function prepareCreditNoteCommissionAdjustmentStatements(
  db: D1Database,
  input: {
    tenantId: string | number;
    creditNoteId: number;
    billId: number;
    items: CreditNoteCommissionItem[];
    reason: string;
    createdBy: string | number;
  },
): Promise<{
  statements: D1PreparedStatement[];
  reversalAmount: number;
  clawbackAmount: number;
  affectedAccrualCount: number;
}> {
  const returnedByBillItem = new Map<number, CreditNoteCommissionItem>();
  for (const item of input.items) returnedByBillItem.set(Number(item.invoice_item_id), item);
  const billItemIds = [...returnedByBillItem.keys()].filter((id) => id > 0);
  if (billItemIds.length === 0) {
    return { statements: [], reversalAmount: 0, clawbackAmount: 0, affectedAccrualCount: 0 };
  }

  const placeholders = billItemIds.map(() => '?').join(',');
  const accruals = await db.prepare(`
    WITH returned_items AS (
      SELECT
        ii.id AS bill_item_id,
        ii.description,
        COALESCE(ii.quantity, 1) AS original_quantity,
        ltc.id AS resolved_lab_test_id
      FROM invoice_items ii
      LEFT JOIN lab_test_catalog ltc
        ON ltc.tenant_id = ii.tenant_id
       AND ltc.billing_service_item_id = ii.reference_id
      WHERE ii.tenant_id = ?
        AND ii.bill_id = ?
        AND ii.id IN (${placeholders})
    )
    SELECT
      a.id,
      a.doctor_id,
      a.bill_id,
      ri.bill_item_id,
      a.bill_item_id AS persisted_bill_item_id,
      a.payable_commission_amount,
      a.paid_amount,
      a.balance_amount,
      ri.original_quantity
    FROM doctor_commission_accruals a
    JOIN returned_items ri
      ON ri.bill_item_id = a.bill_item_id
      OR (
        a.bill_item_id IS NULL
        AND (
          (a.lab_test_id IS NOT NULL AND a.lab_test_id = ri.resolved_lab_test_id)
          OR (
            a.lab_test_id IS NULL
            AND TRIM(COALESCE(ri.description, '')) != ''
            AND LOWER(COALESCE(a.notes, '')) LIKE '%' || LOWER(TRIM(ri.description)) || '%'
          )
        )
      )
    WHERE a.tenant_id = ?
      AND a.bill_id = ?
      AND COALESCE(a.status, 'accrued') != 'cancelled'
  `).bind(
    input.tenantId,
    input.billId,
    ...billItemIds,
    input.tenantId,
    input.billId,
  ).all<CreditNoteCommissionAccrualRow>();

  const statements: D1PreparedStatement[] = [];
  let totalReversal = 0;
  let totalClawback = 0;
  for (const accrual of accruals.results ?? []) {
    const returnItem = returnedByBillItem.get(Number(accrual.bill_item_id));
    if (!returnItem) continue;

    if (accrual.persisted_bill_item_id === null) {
      statements.push(db.prepare(`
        UPDATE doctor_commission_accruals
        SET bill_item_id = ?,
            source_line_type = 'invoice_item',
            source_line_id = CAST(? AS TEXT),
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND id = ? AND bill_item_id IS NULL
      `).bind(accrual.bill_item_id, accrual.bill_item_id, input.tenantId, accrual.id));
    }

    const adjustment = calculateDoctorCommissionReturnAdjustment({
      payableCommissionAmount: Number(accrual.payable_commission_amount ?? 0),
      balanceAmount: Number(accrual.balance_amount ?? 0),
      paidAmount: Number(accrual.paid_amount ?? 0),
      returnedQuantity: Number(returnItem.return_quantity ?? 0),
      originalQuantity: Number(accrual.original_quantity ?? 1),
    });
    const metadata = JSON.stringify({
      targetAdjustmentAmount: adjustment.targetAdjustmentAmount,
      originalBalanceAmount: money(accrual.balance_amount),
      originalPaidAmount: money(accrual.paid_amount),
    });

    if (adjustment.reversalAmount > 0) {
      totalReversal = money(totalReversal + adjustment.reversalAmount);
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO doctor_commission_adjustments (
          tenant_id, doctor_id, accrual_id, credit_note_id, credit_note_item_id,
          bill_id, bill_item_id, adjustment_type, amount,
          returned_quantity, original_quantity, return_ratio,
          status, reason, metadata_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reversal', ?, ?, ?, ?, 'recorded', ?, ?, ?)
      `).bind(
        input.tenantId, accrual.doctor_id, accrual.id, input.creditNoteId,
        returnItem.id ?? null, input.billId, accrual.bill_item_id,
        adjustment.reversalAmount, returnItem.return_quantity, accrual.original_quantity,
        adjustment.returnRatio, input.reason, metadata, input.createdBy,
      ));
    }

    if (adjustment.clawbackAmount > 0) {
      totalClawback = money(totalClawback + adjustment.clawbackAmount);
      statements.push(db.prepare(`
        INSERT OR IGNORE INTO doctor_commission_adjustments (
          tenant_id, doctor_id, accrual_id, credit_note_id, credit_note_item_id,
          bill_id, bill_item_id, adjustment_type, amount,
          returned_quantity, original_quantity, return_ratio,
          status, reason, metadata_json, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'clawback', ?, ?, ?, ?, 'outstanding', ?, ?, ?)
      `).bind(
        input.tenantId, accrual.doctor_id, accrual.id, input.creditNoteId,
        returnItem.id ?? null, input.billId, accrual.bill_item_id,
        adjustment.clawbackAmount, returnItem.return_quantity, accrual.original_quantity,
        adjustment.returnRatio, input.reason, metadata, input.createdBy,
      ));
    }

    if (adjustment.reversalAmount > 0 || adjustment.clawbackAmount > 0) {
      statements.push(db.prepare(`
        UPDATE doctor_commission_accruals
        SET reversed_amount = COALESCE((
              SELECT SUM(amount) FROM doctor_commission_adjustments
              WHERE tenant_id = ? AND accrual_id = ? AND adjustment_type = 'reversal'
                AND status != 'cancelled'
            ), 0),
            clawback_amount = COALESCE((
              SELECT SUM(amount) FROM doctor_commission_adjustments
              WHERE tenant_id = ? AND accrual_id = ? AND adjustment_type = 'clawback'
                AND status != 'cancelled'
            ), 0),
            balance_amount = MAX(0,
              COALESCE(payable_commission_amount, commission_amount, 0)
              - COALESCE(paid_amount, 0)
              - COALESCE((
                  SELECT SUM(amount) FROM doctor_commission_adjustments
                  WHERE tenant_id = ? AND accrual_id = ? AND adjustment_type = 'reversal'
                    AND status != 'cancelled'
                ), 0)
            ),
            status = CASE
              WHEN COALESCE(paid_amount, 0) <= 0
               AND COALESCE((
                  SELECT SUM(amount) FROM doctor_commission_adjustments
                  WHERE tenant_id = ? AND accrual_id = ? AND adjustment_type = 'reversal'
                    AND status != 'cancelled'
                ), 0) >= COALESCE(payable_commission_amount, commission_amount, 0)
                THEN 'cancelled'
              WHEN COALESCE(paid_amount, 0) >= COALESCE(payable_commission_amount, commission_amount, 0)
                THEN 'paid'
              ELSE status
            END,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND id = ?
      `).bind(
        input.tenantId, accrual.id,
        input.tenantId, accrual.id,
        input.tenantId, accrual.id,
        input.tenantId, accrual.id,
        input.tenantId, accrual.id,
      ));
    }
  }

  return {
    statements,
    reversalAmount: totalReversal,
    clawbackAmount: totalClawback,
    affectedAccrualCount: (accruals.results ?? []).length,
  };
}
