import { assertAccountingPeriodOpen } from '../../../lib/accounting-hardening';
import { issueCreditNote } from '../../../lib/canonical/commands/issue-credit-note';
import { getTodayGMT6 } from '../../../lib/date-utils';
import { getCanonicalReceivable } from '../../actionCenter/collections/canonicalAdapter';
import type { ReceivableRecord } from '../../actionCenter/collections/types';
import {
  prepareReceivableAdjustment,
  type PreparedReceivableAdjustment,
  type ReceivableAdjustmentInput,
  type ReceivableAdjustmentResult,
} from './types';

interface ExistingCanonicalCreditNoteRow {
  creditNotePublicId: string;
  totalMinor: number;
  previousDueMinor: number;
  newDueMinor: number;
  currencyCode: string;
  invoicePublicId: string;
  reasonCode: string;
}

interface MappingRow {
  canonicalPublicId: string;
}

async function resolveCanonicalInvoicePublicId(
  input: PreparedReceivableAdjustment,
): Promise<string> {
  const direct = input.source.canonicalInvoicePublicId?.trim();
  const legacyBillId = input.source.legacyBillId;
  if (direct && legacyBillId === undefined) return direct;
  if (!Number.isSafeInteger(legacyBillId) || Number(legacyBillId) <= 0) {
    throw new Error('Canonical receivable adjustment requires an invoice public ID or legacy mapping');
  }
  const mapping = await input.db.prepare(`
    SELECT canonical_public_id AS "canonicalPublicId"
    FROM canonical_source_mappings
    WHERE tenant_id = ?
      AND entity_type = 'invoice'
      AND source_table = 'bills'
      AND source_public_id = ?
      AND mapping_status = 'mapped'
    ORDER BY id ASC
    LIMIT 1
  `).bind(input.tenantId, String(legacyBillId)).first<MappingRow>();
  if (!mapping?.canonicalPublicId?.trim()) {
    throw new Error('Canonical invoice mapping not found');
  }
  const mapped = mapping.canonicalPublicId.trim();
  if (direct && mapped !== direct) {
    throw new Error('Canonical invoice does not match the supplied legacy bill mapping');
  }
  return mapped;
}

async function readReplay(
  input: PreparedReceivableAdjustment,
  canonicalInvoicePublicId: string,
): Promise<ReceivableAdjustmentResult | null> {
  const row = await input.db.prepare(`
    SELECT
      credit_note_public_id AS "creditNotePublicId",
      total_minor AS "totalMinor",
      invoice_net_due_before_minor AS "previousDueMinor",
      invoice_net_due_after_minor AS "newDueMinor",
      currency_code AS "currencyCode",
      invoice_public_id AS "invoicePublicId",
      reason_code AS "reasonCode"
    FROM canonical_credit_notes
    WHERE tenant_id = ? AND credit_note_public_id = ?
    LIMIT 1
  `).bind(
    input.tenantId,
    input.canonicalCreditNotePublicId,
  ).first<ExistingCanonicalCreditNoteRow>();
  if (!row) return null;
  if (
    Number(row.totalMinor) !== input.amountMinor
    || row.currencyCode !== input.currencyCode
    || row.invoicePublicId !== canonicalInvoicePublicId
    || row.reasonCode !== input.reasonCode
  ) {
    throw new Error('Existing canonical credit note does not match the adjustment request');
  }
  return {
    authorityMode: 'canonical',
    adjustmentPublicId: input.adjustmentPublicId,
    canonicalCreditNotePublicId: row.creditNotePublicId,
    previousDueMinor: Number(row.previousDueMinor),
    newDueMinor: Number(row.newDueMinor),
    appliedAmountMinor: Number(row.totalMinor),
    currencyCode: row.currencyCode,
  };
}

function validateLiveReceivable(
  record: ReceivableRecord | null,
  input: PreparedReceivableAdjustment,
): ReceivableRecord {
  if (!record) throw new Error('Canonical receivable source was not found');
  if (record.financialStatus !== 'open') {
    throw new Error(`Canonical receivable is not open: ${record.financialStatus}`);
  }
  if (record.currencyCode !== input.currencyCode) {
    throw new Error(`Receivable currency mismatch: expected ${record.currencyCode}`);
  }
  if (input.amountMinor > record.dueMinor) {
    throw new RangeError('Receivable adjustment exceeds the canonical outstanding balance');
  }
  return record;
}

export async function applyPreparedCanonicalReceivableAdjustment(
  input: PreparedReceivableAdjustment,
): Promise<ReceivableAdjustmentResult> {
  const canonicalInvoicePublicId = await resolveCanonicalInvoicePublicId(input);
  const replay = await readReplay(input, canonicalInvoicePublicId);
  if (replay) return replay;
  const businessDate = getTodayGMT6();
  await assertAccountingPeriodOpen(input.db, input.tenantId, businessDate, 'Receivable adjustment');
  const live = validateLiveReceivable(await getCanonicalReceivable({
    db: input.db,
    tenantId: input.tenantId,
    canonicalInvoicePublicId,
  }), input);
  const issuedAtUtc = new Date().toISOString();
  const command = await issueCreditNote(input.db, {
    tenantId: input.tenantId,
    creditNotePublicId: input.canonicalCreditNotePublicId,
    creditNoteNumber: input.creditNoteNumber,
    invoicePublicId: canonicalInvoicePublicId,
    reasonCode: input.reasonCode,
    issuedAtUtc,
    businessDate,
    lines: [{
      creditLinePublicId: input.canonicalCreditLinePublicId,
      invoiceLinePublicId: null,
      amountMinor: input.amountMinor,
      reasonCode: input.reasonCode,
      sourceEvidenceSha256: input.sourceEvidenceSha256,
    }],
    sourceType: input.sourceType,
    sourcePublicId: String(input.sourceRequestId),
    sourceTable: input.sourceType === 'receivable_write_off'
      ? 'approval_requests'
      : 'billing_credit_notes',
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    idempotencyKey: input.idempotencyKey,
    outboxEventPublicId: input.canonicalOutboxEventPublicId,
  });

  return {
    authorityMode: 'canonical',
    adjustmentPublicId: input.adjustmentPublicId,
    canonicalCreditNotePublicId: input.canonicalCreditNotePublicId,
    previousDueMinor: live.dueMinor,
    newDueMinor: command.result.netDueMinor,
    appliedAmountMinor: command.result.totalMinor,
    currencyCode: live.currencyCode,
  };
}

export async function applyCanonicalReceivableAdjustment(
  input: ReceivableAdjustmentInput,
): Promise<ReceivableAdjustmentResult> {
  return applyPreparedCanonicalReceivableAdjustment(await prepareReceivableAdjustment(input));
}
