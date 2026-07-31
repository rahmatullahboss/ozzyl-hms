import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
} from '../../../lib/accounting-posting';
import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../../lib/date-utils';
import { assertNoPaidPerformerReserves } from '../../../lib/diagnostic-performer-reserve';
import { getLegacyReceivable } from '../../actionCenter/collections/legacyAdapter';
import type { ReceivableRecord } from '../../actionCenter/collections/types';
import {
  minorToMajor,
  prepareReceivableAdjustment,
  type PreparedReceivableAdjustment,
  type ReceivableAdjustmentInput,
  type ReceivableAdjustmentResult,
} from './types';

interface ExistingCreditNoteRow {
  id: number;
  remarks: string | null;
}

interface StoredLegacyAdjustmentEvidence {
  schemaVersion: 1;
  adjustmentPublicId: string;
  sourceType: ReceivableAdjustmentInput['sourceType'];
  sourceRequestId: number;
  previousDueMinor: number;
  newDueMinor: number;
  appliedAmountMinor: number;
  currencyCode: string;
  reasonCode: string;
}

function requireLegacySource(input: PreparedReceivableAdjustment): number {
  const legacyBillId = input.source.legacyBillId;
  if (!Number.isSafeInteger(legacyBillId) || Number(legacyBillId) <= 0) {
    throw new Error('Legacy receivable adjustment requires a valid legacy bill ID');
  }
  return Number(legacyBillId);
}

function validateLiveReceivable(
  record: ReceivableRecord | null,
  input: PreparedReceivableAdjustment,
): ReceivableRecord {
  if (!record) throw new Error('Legacy receivable source was not found');
  if (record.financialStatus !== 'open') {
    throw new Error(`Legacy receivable is not open: ${record.financialStatus}`);
  }
  if (record.currencyCode !== input.currencyCode) {
    throw new Error(`Receivable currency mismatch: expected ${record.currencyCode}`);
  }
  if (input.amountMinor > record.dueMinor) {
    throw new RangeError('Receivable adjustment exceeds the live due balance');
  }
  if (record.totalMinor - input.amountMinor < record.paidMinor) {
    throw new RangeError('Receivable adjustment would reduce invoice total below paid money');
  }
  return record;
}

function parseStoredEvidence(value: string | null): StoredLegacyAdjustmentEvidence | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredLegacyAdjustmentEvidence>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.adjustmentPublicId !== 'string'
      || !Number.isSafeInteger(parsed.previousDueMinor)
      || !Number.isSafeInteger(parsed.newDueMinor)
      || !Number.isSafeInteger(parsed.appliedAmountMinor)
      || typeof parsed.currencyCode !== 'string'
      || typeof parsed.reasonCode !== 'string'
    ) return null;
    return parsed as StoredLegacyAdjustmentEvidence;
  } catch {
    return null;
  }
}

async function readReplay(
  input: PreparedReceivableAdjustment,
): Promise<ReceivableAdjustmentResult | null> {
  const row = await input.db.prepare(`
    SELECT id, remarks
    FROM billing_credit_notes
    WHERE tenant_id = ? AND credit_note_no = ? AND is_active = 1
    ORDER BY id ASC
    LIMIT 1
  `).bind(input.tenantId, input.creditNoteNumber).first<ExistingCreditNoteRow>();
  if (!row) return null;
  const evidence = parseStoredEvidence(row.remarks);
  if (
    !evidence
    || evidence.adjustmentPublicId !== input.adjustmentPublicId
    || evidence.sourceType !== input.sourceType
    || evidence.sourceRequestId !== input.sourceRequestId
    || evidence.appliedAmountMinor !== input.amountMinor
    || evidence.currencyCode !== input.currencyCode
    || evidence.reasonCode !== input.reasonCode
  ) {
    throw new Error('Existing legacy credit note does not match the adjustment request');
  }
  return {
    authorityMode: 'legacy',
    adjustmentPublicId: evidence.adjustmentPublicId,
    legacyCreditNoteId: Number(row.id),
    previousDueMinor: evidence.previousDueMinor,
    newDueMinor: evidence.newDueMinor,
    appliedAmountMinor: evidence.appliedAmountMinor,
    currencyCode: evidence.currencyCode,
  };
}

export async function applyPreparedLegacyReceivableAdjustment(
  input: PreparedReceivableAdjustment,
): Promise<ReceivableAdjustmentResult> {
  const replay = await readReplay(input);
  if (replay) return replay;

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(input.db, input.tenantId, today, 'Receivable adjustment');
  const legacyBillId = requireLegacySource(input);
  const live = validateLiveReceivable(await getLegacyReceivable({
    db: input.db,
    tenantId: input.tenantId,
    legacyBillId,
  }), input);
  await assertNoPaidPerformerReserves(input.db, input.tenantId, { billId: legacyBillId });

  const previousDueMinor = live.dueMinor;
  const newDueMinor = previousDueMinor - input.amountMinor;
  const newTotalMinor = live.totalMinor - input.amountMinor;
  const newStatus = newDueMinor === 0 ? 'paid' : live.paidMinor > 0 ? 'partially_paid' : 'open';
  const adjustmentMajor = minorToMajor(input.amountMinor);
  const previousTotalMajor = minorToMajor(live.totalMinor);
  const previousPaidMajor = minorToMajor(live.paidMinor);
  const previousDueMajor = minorToMajor(previousDueMinor);
  const newTotalMajor = minorToMajor(newTotalMinor);
  const newDueMajor = minorToMajor(newDueMinor);
  const evidence: StoredLegacyAdjustmentEvidence = {
    schemaVersion: 1,
    adjustmentPublicId: input.adjustmentPublicId,
    sourceType: input.sourceType,
    sourceRequestId: input.sourceRequestId,
    previousDueMinor,
    newDueMinor,
    appliedAmountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
    reasonCode: input.reasonCode,
  };
  const evidenceJson = JSON.stringify(evidence);
  const creditNoteIdLookup = `(
    SELECT id FROM billing_credit_notes
    WHERE tenant_id = ? AND credit_note_no = ?
    ORDER BY id ASC LIMIT 1
  )`;
  const sourceEventKey = createPostingEventKey(
    input.sourceType,
    input.sourceRequestId,
    ACCOUNTING_EVENT_TYPES.creditNoteIssued,
  );
  const postingPayload = JSON.stringify({
    creditNoteNo: input.creditNoteNumber,
    billId: legacyBillId,
    patientId: live.patientId,
    total: adjustmentMajor,
    receivableReduction: adjustmentMajor,
    cashRefund: 0,
    paymentMethod: 'write_off',
    testBill: 0,
    doctorVisitBill: 0,
    admissionBill: 0,
    operationBill: 0,
    medicineBill: 0,
    sourceType: input.sourceType,
    sourceRequestId: input.sourceRequestId,
    adjustmentPublicId: input.adjustmentPublicId,
  });

  const statements = [
    input.db.prepare(`
      INSERT INTO billing_credit_notes (
        tenant_id, credit_note_no, bill_id, patient_id, reason,
        total_amount, refund_amount, payment_mode, remarks,
        status, created_by, approved_by, approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 'write_off', ?, 'approved', ?, ?, datetime('now', '+6 hours'))
    `).bind(
      input.tenantId,
      input.creditNoteNumber,
      legacyBillId,
      live.patientId,
      input.reasonCode,
      adjustmentMajor,
      evidenceJson,
      input.actorId,
      input.actorId,
    ),
    input.db.prepare(`
      UPDATE bills
      SET total = ?, due = ?, status = ?
      WHERE tenant_id = ? AND id = ?
        AND total = ? AND paid = ? AND due = ?
        AND lower(status) NOT IN ('draft', 'cancelled', 'canceled', 'refunded', 'reversed')
    `).bind(
      newTotalMajor,
      newDueMajor,
      newStatus,
      input.tenantId,
      legacyBillId,
      previousTotalMajor,
      previousPaidMajor,
      previousDueMajor,
    ),
    input.db.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      ) VALUES (
        CASE WHEN changes() = 1 THEN ? ELSE NULL END,
        ?, 'APPROVE', 'billing_credit_notes', ${creditNoteIdLookup}, ?, ?,
        NULL, NULL, datetime('now', '+6 hours')
      )
    `).bind(
      input.tenantId,
      input.actorId,
      input.tenantId,
      input.creditNoteNumber,
      JSON.stringify({ totalMinor: live.totalMinor, paidMinor: live.paidMinor, dueMinor: previousDueMinor }),
      JSON.stringify({
        action: 'receivable_adjustment_applied',
        adjustmentPublicId: input.adjustmentPublicId,
        totalMinor: newTotalMinor,
        paidMinor: live.paidMinor,
        dueMinor: newDueMinor,
        amountMinor: input.amountMinor,
        currencyCode: input.currencyCode,
        sourceType: input.sourceType,
        sourceRequestId: input.sourceRequestId,
      }),
    ),
    input.db.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (?, 'other', ?, ?, ?, ?, ?)
    `).bind(
      today,
      -adjustmentMajor,
      `Receivable adjustment ${input.creditNoteNumber}: ${input.reasonCode}`,
      legacyBillId,
      input.tenantId,
      input.actorId,
    ),
    input.db.prepare(`
      INSERT INTO accounting_posting_events (
        tenant_id, source_event_key, source_type, source_id,
        event_type, event_date, payload_json, created_by
      ) VALUES (?, ?, 'credit_note', ${creditNoteIdLookup}, ?, ?, ?, ?)
    `).bind(
      input.tenantId,
      sourceEventKey,
      input.tenantId,
      input.creditNoteNumber,
      ACCOUNTING_EVENT_TYPES.creditNoteIssued,
      today,
      postingPayload,
      String(input.actorId),
    ),
  ];

  await input.db.batch(statements);
  const created = await input.db.prepare(`
    SELECT id FROM billing_credit_notes
    WHERE tenant_id = ? AND credit_note_no = ?
    ORDER BY id ASC LIMIT 1
  `).bind(input.tenantId, input.creditNoteNumber).first<{ id: number }>();
  const legacyCreditNoteId = Number(created?.id ?? 0);
  if (!Number.isSafeInteger(legacyCreditNoteId) || legacyCreditNoteId <= 0) {
    throw new Error('Legacy credit note evidence was not created');
  }

  return {
    authorityMode: 'legacy',
    adjustmentPublicId: input.adjustmentPublicId,
    legacyCreditNoteId,
    previousDueMinor,
    newDueMinor,
    appliedAmountMinor: input.amountMinor,
    currencyCode: input.currencyCode,
  };
}

export async function applyLegacyReceivableAdjustment(
  input: ReceivableAdjustmentInput,
): Promise<ReceivableAdjustmentResult> {
  return applyPreparedLegacyReceivableAdjustment(await prepareReceivableAdjustment(input));
}
