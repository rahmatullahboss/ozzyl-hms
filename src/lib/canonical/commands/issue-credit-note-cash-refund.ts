import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { stableCanonicalJson } from '../idempotency';
import type {
  CreditNoteCashRefundAllocationSlice,
  CreditNoteCashRefundReceiptSlice,
  CreditNoteCashRefundTenderAttribution,
} from '../live-credit-note-cash-refund';
import { toUtcIso } from '../time';
import type {
  CreditNoteLineInput,
  IssueCreditNoteInput,
} from './issue-credit-note';

export interface IssueCreditNoteCashRefundInput extends IssueCreditNoteInput {
  refundPublicId: string;
  cashRefundMinor: number;
  payoutMethodCode: string;
  legacyCounterId: number;
  legacyCounterSessionId: number;
  refundSourceEvidenceSha256: string;
  receiptSlices: readonly CreditNoteCashRefundReceiptSlice[];
  allocationSlices: readonly CreditNoteCashRefundAllocationSlice[];
  tenderAttributions: readonly CreditNoteCashRefundTenderAttribution[];
  cashRefundEventPublicId: string;
  cashCustodyEventPublicId: string;
}

export interface IssueCreditNoteCashRefundResult {
  creditNotePublicId: string;
  refundPublicId: string;
  totalMinor: number;
  cashRefundMinor: number;
  invoicePaidMinor: number;
  invoiceDueMinor: number;
  invoiceCreditedMinor: number;
  invoiceNetDueMinor: number;
}

interface InvoiceRow {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

interface AllocationRow {
  receipt_public_id: string;
  invoice_public_id: string;
  reversed_minor: number;
  remaining_minor: number;
  status: string;
}

interface ReceiptRow {
  refunded_minor: number;
  net_received_minor: number;
  status: string;
}

interface TenderRow {
  receipt_public_id: string;
  tender_type: string;
  method_code: string;
  remaining_minor: number;
  prior_attributed_minor: number;
  status: string;
}

interface NameRow {
  name: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

function validateLine(line: CreditNoteLineInput, ids: Set<string>): void {
  exact(line.creditLinePublicId, 'line.creditLinePublicId');
  if (ids.has(line.creditLinePublicId)) throw new RangeError('duplicate creditLinePublicId');
  ids.add(line.creditLinePublicId);
  if (line.invoiceLinePublicId != null) exact(line.invoiceLinePublicId, 'line.invoiceLinePublicId');
  positive(line.amountMinor, 'line.amountMinor');
  exact(line.reasonCode, 'line.reasonCode');
  digest(line.sourceEvidenceSha256, 'line.sourceEvidenceSha256');
}

function sum(rows: readonly { amountMinor: number }[]): number {
  let total = 0n;
  for (const row of rows) {
    total += BigInt(positive(row.amountMinor, 'slice.amountMinor'));
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('slice total exceeds safe integer range');
    }
  }
  return Number(total);
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new RangeError(`duplicate ${label}`);
}

async function tableExists(db: CanonicalBatchDatabase, tableName: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1
  `).bind(tableName).first<NameRow>();
  return row !== null;
}

async function assertCompensationSafe(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<void> {
  const canonicalBlocked = await db.prepare(`
    SELECT 1 present
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND invoice_public_id=? AND settled_minor>0
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (canonicalBlocked) {
    throw new Error('Paid performer reserve or compensation settlement blocks credit refund');
  }

  const [hasPerformerReserves, hasDoctorAccruals] = await Promise.all([
    tableExists(db, 'diagnostic_performer_reserves'),
    tableExists(db, 'doctor_commission_accruals'),
  ]);
  if (!hasPerformerReserves && !hasDoctorAccruals) return;

  const predicates: string[] = [];
  if (hasPerformerReserves) {
    predicates.push(`EXISTS (
      SELECT 1 FROM diagnostic_performer_reserves r
      WHERE r.tenant_id=m.tenant_id
        AND r.bill_id=CAST(m.source_public_id AS INTEGER)
        AND r.status='paid'
    )`);
  }
  if (hasDoctorAccruals) {
    predicates.push(`EXISTS (
      SELECT 1 FROM doctor_commission_accruals a
      WHERE a.tenant_id=m.tenant_id
        AND a.bill_id=CAST(m.source_public_id AS INTEGER)
        AND a.status='paid'
    )`);
  }
  const legacyBlocked = await db.prepare(`
    SELECT 1 present
    FROM canonical_source_mappings m
    WHERE m.tenant_id=?
      AND m.entity_type='invoice'
      AND m.canonical_public_id=?
      AND m.mapping_status='mapped'
      AND m.source_table='bills'
      AND (${predicates.join(' OR ')})
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (legacyBlocked) {
    throw new Error('Paid performer reserve or compensation settlement blocks credit refund');
  }
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: IssueCreditNoteCashRefundInput,
  entityType: 'credit_note' | 'credit_note_cash_refund',
  canonicalPublicId: string,
  evidenceSha256: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    entityType,
    canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    evidenceSha256,
  );
}

function validateReceiptSlices(input: IssueCreditNoteCashRefundInput): Map<string, CreditNoteCashRefundReceiptSlice> {
  if (input.receiptSlices.length === 0) throw new RangeError('cash refund requires receipt slices');
  assertUnique(input.receiptSlices.map((row) => row.receiptSlicePublicId), 'receiptSlicePublicId');
  assertUnique(input.receiptSlices.map((row) => row.receiptPublicId), 'receiptPublicId');
  const byId = new Map<string, CreditNoteCashRefundReceiptSlice>();
  for (const row of input.receiptSlices) {
    exact(row.receiptSlicePublicId, 'receiptSlice.receiptSlicePublicId');
    exact(row.receiptPublicId, 'receiptSlice.receiptPublicId');
    positive(row.amountMinor, 'receiptSlice.amountMinor');
    nonNegative(row.receiptRefundedBeforeMinor, 'receiptSlice.receiptRefundedBeforeMinor');
    if (row.receiptRefundedAfterMinor !== row.receiptRefundedBeforeMinor + row.amountMinor) {
      throw new RangeError('receipt slice refunded balance does not reconcile');
    }
    positive(row.receiptNetReceivedBeforeMinor, 'receiptSlice.receiptNetReceivedBeforeMinor');
    if (row.receiptNetReceivedAfterMinor !== row.receiptNetReceivedBeforeMinor - row.amountMinor) {
      throw new RangeError('receipt slice net received balance does not reconcile');
    }
    if (row.receiptNetReceivedAfterMinor < 0) throw new RangeError('receipt slice exceeds net received balance');
    digest(row.sourceEvidenceSha256, 'receiptSlice.sourceEvidenceSha256');
    byId.set(row.receiptSlicePublicId, row);
  }
  return byId;
}

function validateAllocationSlices(
  input: IssueCreditNoteCashRefundInput,
  receipts: ReadonlyMap<string, CreditNoteCashRefundReceiptSlice>,
): void {
  if (input.allocationSlices.length === 0) throw new RangeError('cash refund requires allocation slices');
  assertUnique(input.allocationSlices.map((row) => row.allocationSlicePublicId), 'allocationSlicePublicId');
  assertUnique(input.allocationSlices.map((row) => row.allocationPublicId), 'allocationPublicId');
  const totals = new Map<string, number>();
  for (const row of input.allocationSlices) {
    exact(row.allocationSlicePublicId, 'allocationSlice.allocationSlicePublicId');
    const receipt = receipts.get(exact(row.receiptSlicePublicId, 'allocationSlice.receiptSlicePublicId'));
    if (!receipt || receipt.receiptPublicId !== row.receiptPublicId) {
      throw new RangeError('allocation slice receipt lineage mismatch');
    }
    exact(row.allocationPublicId, 'allocationSlice.allocationPublicId');
    positive(row.amountMinor, 'allocationSlice.amountMinor');
    nonNegative(row.allocationReversedBeforeMinor, 'allocationSlice.allocationReversedBeforeMinor');
    if (row.allocationReversedAfterMinor !== row.allocationReversedBeforeMinor + row.amountMinor) {
      throw new RangeError('allocation slice reversed balance does not reconcile');
    }
    positive(row.allocationRemainingBeforeMinor, 'allocationSlice.allocationRemainingBeforeMinor');
    if (row.allocationRemainingAfterMinor !== row.allocationRemainingBeforeMinor - row.amountMinor) {
      throw new RangeError('allocation slice remaining balance does not reconcile');
    }
    if (row.allocationRemainingAfterMinor < 0) throw new RangeError('allocation slice exceeds remaining balance');
    digest(row.sourceEvidenceSha256, 'allocationSlice.sourceEvidenceSha256');
    totals.set(row.receiptSlicePublicId, (totals.get(row.receiptSlicePublicId) ?? 0) + row.amountMinor);
  }
  for (const receipt of receipts.values()) {
    if ((totals.get(receipt.receiptSlicePublicId) ?? 0) !== receipt.amountMinor) {
      throw new RangeError('allocation slice total does not reconcile to receipt slice');
    }
  }
}

function validateTenderAttributions(
  input: IssueCreditNoteCashRefundInput,
  receipts: ReadonlyMap<string, CreditNoteCashRefundReceiptSlice>,
): void {
  if (input.tenderAttributions.length === 0) throw new RangeError('cash refund requires tender attributions');
  assertUnique(input.tenderAttributions.map((row) => row.tenderAttributionPublicId), 'tenderAttributionPublicId');
  assertUnique(input.tenderAttributions.map((row) => row.tenderPublicId), 'tenderPublicId');
  const totals = new Map<string, number>();
  for (const row of input.tenderAttributions) {
    exact(row.tenderAttributionPublicId, 'tenderAttribution.tenderAttributionPublicId');
    const receipt = receipts.get(exact(row.receiptSlicePublicId, 'tenderAttribution.receiptSlicePublicId'));
    if (!receipt || receipt.receiptPublicId !== row.receiptPublicId) {
      throw new RangeError('tender attribution receipt lineage mismatch');
    }
    exact(row.tenderPublicId, 'tenderAttribution.tenderPublicId');
    positive(row.amountMinor, 'tenderAttribution.amountMinor');
    exact(row.tenderType, 'tenderAttribution.tenderType');
    exact(row.methodCode, 'tenderAttribution.methodCode');
    positive(row.attributableBeforeMinor, 'tenderAttribution.attributableBeforeMinor');
    if (row.attributableAfterMinor !== row.attributableBeforeMinor - row.amountMinor) {
      throw new RangeError('tender attribution balance does not reconcile');
    }
    if (row.attributableAfterMinor < 0) throw new RangeError('tender attribution exceeds available balance');
    digest(row.sourceEvidenceSha256, 'tenderAttribution.sourceEvidenceSha256');
    totals.set(row.receiptSlicePublicId, (totals.get(row.receiptSlicePublicId) ?? 0) + row.amountMinor);
  }
  for (const receipt of receipts.values()) {
    if ((totals.get(receipt.receiptSlicePublicId) ?? 0) !== receipt.amountMinor) {
      throw new RangeError('tender attribution total does not reconcile to receipt slice');
    }
  }
}

async function assertSourceAuthority(
  db: CanonicalBatchDatabase,
  input: IssueCreditNoteCashRefundInput,
): Promise<void> {
  for (const row of input.receiptSlices) {
    const source = await db.prepare(`
      SELECT refunded_minor,net_received_minor,status
      FROM canonical_payment_receipts
      WHERE tenant_id=? AND receipt_public_id=?
      LIMIT 1
    `).bind(input.tenantId, row.receiptPublicId).first<ReceiptRow>();
    if (
      !source
      || source.status !== 'posted'
      || Number(source.refunded_minor) !== row.receiptRefundedBeforeMinor
      || Number(source.net_received_minor) !== row.receiptNetReceivedBeforeMinor
    ) {
      throw new Error('Canonical payment receipt authority changed');
    }
  }
  for (const row of input.allocationSlices) {
    const source = await db.prepare(`
      SELECT receipt_public_id,invoice_public_id,reversed_minor,remaining_minor,status
      FROM canonical_payment_allocations
      WHERE tenant_id=? AND allocation_public_id=?
      LIMIT 1
    `).bind(input.tenantId, row.allocationPublicId).first<AllocationRow>();
    if (
      !source
      || source.status !== 'active'
      || source.receipt_public_id !== row.receiptPublicId
      || source.invoice_public_id !== input.invoicePublicId
      || Number(source.reversed_minor) !== row.allocationReversedBeforeMinor
      || Number(source.remaining_minor) !== row.allocationRemainingBeforeMinor
    ) {
      throw new Error('Canonical payment allocation authority changed');
    }
  }
  for (const row of input.tenderAttributions) {
    const source = await db.prepare(`
      SELECT
        t.receipt_public_id,t.tender_type,t.method_code,t.remaining_minor,t.status,
        COALESCE((
          SELECT SUM(attr.amount_minor)
          FROM canonical_credit_note_refund_tender_attributions attr
          INNER JOIN canonical_credit_note_cash_refunds refund
            ON refund.tenant_id=attr.tenant_id
           AND refund.refund_public_id=attr.refund_public_id
          WHERE attr.tenant_id=t.tenant_id
            AND attr.tender_public_id=t.tender_public_id
            AND refund.status='posted'
        ),0) AS prior_attributed_minor
      FROM canonical_payment_tenders t
      WHERE t.tenant_id=? AND t.tender_public_id=?
      LIMIT 1
    `).bind(input.tenantId, row.tenderPublicId).first<TenderRow>();
    if (
      !source
      || source.status !== 'captured'
      || source.receipt_public_id !== row.receiptPublicId
      || source.tender_type !== row.tenderType
      || source.method_code !== row.methodCode
      || Number(source.remaining_minor) - Number(source.prior_attributed_minor) !== row.attributableBeforeMinor
    ) {
      throw new Error('Canonical payment tender attribution authority changed');
    }
  }
}

export async function issueCreditNoteWithCashRefund(
  db: CanonicalBatchDatabase,
  input: IssueCreditNoteCashRefundInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<IssueCreditNoteCashRefundResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.creditNotePublicId, 'creditNotePublicId');
  exact(input.creditNoteNumber, 'creditNoteNumber');
  exact(input.invoicePublicId, 'invoicePublicId');
  exact(input.reasonCode, 'reasonCode');
  utc(input.issuedAtUtc, 'issuedAtUtc');
  exact(input.businessDate, 'businessDate');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  exact(input.refundPublicId, 'refundPublicId');
  positive(input.cashRefundMinor, 'cashRefundMinor');
  exact(input.payoutMethodCode, 'payoutMethodCode');
  positive(input.legacyCounterId, 'legacyCounterId');
  positive(input.legacyCounterSessionId, 'legacyCounterSessionId');
  digest(input.refundSourceEvidenceSha256, 'refundSourceEvidenceSha256');
  exact(input.cashRefundEventPublicId, 'cashRefundEventPublicId');
  exact(input.cashCustodyEventPublicId, 'cashCustodyEventPublicId');
  if (input.lines.length === 0) throw new RangeError('credit note must contain at least one line');

  const lineIds = new Set<string>();
  for (const line of input.lines) validateLine(line, lineIds);
  const totalMinor = sum(input.lines);
  if (input.cashRefundMinor > totalMinor) {
    throw new RangeError('Cash refund cannot exceed credit note total');
  }
  const receiptMap = validateReceiptSlices(input);
  validateAllocationSlices(input, receiptMap);
  validateTenderAttributions(input, receiptMap);
  if (sum(input.receiptSlices) !== input.cashRefundMinor) {
    throw new RangeError('receipt slice total must equal cash refund');
  }
  if (sum(input.allocationSlices) !== input.cashRefundMinor) {
    throw new RangeError('allocation slice total must equal cash refund');
  }
  if (sum(input.tenderAttributions) !== input.cashRefundMinor) {
    throw new RangeError('tender attribution total must equal cash refund');
  }

  const request = {
    creditNotePublicId: input.creditNotePublicId,
    creditNoteNumber: input.creditNoteNumber,
    invoicePublicId: input.invoicePublicId,
    reasonCode: input.reasonCode,
    issuedAtUtc: input.issuedAtUtc,
    businessDate: input.businessDate,
    lines: input.lines,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
    refundPublicId: input.refundPublicId,
    cashRefundMinor: input.cashRefundMinor,
    payoutMethodCode: input.payoutMethodCode,
    legacyCounterId: input.legacyCounterId,
    legacyCounterSessionId: input.legacyCounterSessionId,
    refundSourceEvidenceSha256: input.refundSourceEvidenceSha256,
    receiptSlices: input.receiptSlices,
    allocationSlices: input.allocationSlices,
    tenderAttributions: input.tenderAttributions,
  };
  const replay = await readCanonicalCommandReplay<IssueCreditNoteCashRefundResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.credit_note.cash_refund',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const invoice = await db.prepare(`
    SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.invoicePublicId).first<InvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (invoice.net_due_minor !== invoice.due_minor - invoice.credited_minor) {
    throw new Error('Canonical invoice adjustment projection is inconsistent');
  }
  if (invoice.paid_minor < input.cashRefundMinor) {
    throw new RangeError('Cash refund exceeds canonical invoice paid balance');
  }
  if (invoice.net_due_minor + input.cashRefundMinor < totalMinor) {
    throw new RangeError('Credit note exceeds refundable invoice balance');
  }
  await assertCompensationSafe(db, input.tenantId, input.invoicePublicId);
  await assertSourceAuthority(db, input);

  for (const line of input.lines) {
    if (line.invoiceLinePublicId == null) continue;
    const found = await db.prepare(`
      SELECT 1 present FROM canonical_invoice_lines
      WHERE tenant_id=? AND invoice_public_id=? AND line_public_id=?
      LIMIT 1
    `).bind(input.tenantId, input.invoicePublicId, line.invoiceLinePublicId)
      .first<{ present: number }>();
    if (!found) throw new Error('Canonical invoice line not found');
  }

  const invoicePaidAfter = invoice.paid_minor - input.cashRefundMinor;
  const invoiceDueAfter = invoice.due_minor + input.cashRefundMinor;
  const invoiceCreditedAfter = invoice.credited_minor + totalMinor;
  const creditNetDueBefore = invoice.net_due_minor + input.cashRefundMinor;
  const invoiceNetDueAfter = creditNetDueBefore - totalMinor;
  const result: IssueCreditNoteCashRefundResult = {
    creditNotePublicId: input.creditNotePublicId,
    refundPublicId: input.refundPublicId,
    totalMinor,
    cashRefundMinor: input.cashRefundMinor,
    invoicePaidMinor: invoicePaidAfter,
    invoiceDueMinor: invoiceDueAfter,
    invoiceCreditedMinor: invoiceCreditedAfter,
    invoiceNetDueMinor: invoiceNetDueAfter,
  };

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_credit_notes (
        tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
        legacy_patient_id,currency_code,reason_code,total_minor,
        invoice_credited_before_minor,invoice_credited_after_minor,
        invoice_net_due_before_minor,invoice_net_due_after_minor,status,
        issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
        source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?,1,?)
    `).bind(
      input.tenantId,
      input.creditNotePublicId,
      input.creditNoteNumber,
      input.invoicePublicId,
      invoice.legacy_patient_id,
      invoice.currency_code,
      input.reasonCode,
      totalMinor,
      invoice.credited_minor,
      invoiceCreditedAfter,
      creditNetDueBefore,
      invoiceNetDueAfter,
      input.issuedAtUtc,
      input.businessDate,
      input.issuedAtUtc,
      input.sourceEvidenceSha256,
    ),
    ...input.lines.map((line) => db.prepare(`
      INSERT INTO canonical_credit_note_lines (
        tenant_id,credit_line_public_id,credit_note_public_id,invoice_public_id,
        invoice_line_public_id,amount_minor,reason_code,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      input.tenantId,
      line.creditLinePublicId,
      input.creditNotePublicId,
      input.invoicePublicId,
      line.invoiceLinePublicId ?? null,
      line.amountMinor,
      line.reasonCode,
      line.sourceEvidenceSha256,
    )),
    db.prepare(`
      INSERT INTO canonical_credit_note_cash_refunds (
        tenant_id,refund_public_id,credit_note_public_id,invoice_public_id,
        amount_minor,payout_tender_type,payout_method_code,legacy_counter_id,
        legacy_counter_session_id,status,refunded_at_utc,business_date,
        reconciliation_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,'cash',?,?,?,'posted',?,?,1,?)
    `).bind(
      input.tenantId,
      input.refundPublicId,
      input.creditNotePublicId,
      input.invoicePublicId,
      input.cashRefundMinor,
      input.payoutMethodCode,
      input.legacyCounterId,
      input.legacyCounterSessionId,
      input.issuedAtUtc,
      input.businessDate,
      input.refundSourceEvidenceSha256,
    ),
    ...input.receiptSlices.map((row) => db.prepare(`
      INSERT INTO canonical_credit_note_refund_receipts (
        tenant_id,receipt_slice_public_id,refund_public_id,receipt_public_id,
        amount_minor,receipt_refunded_before_minor,receipt_refunded_after_minor,
        receipt_net_received_before_minor,receipt_net_received_after_minor,
        balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,1,?)
    `).bind(
      input.tenantId,
      row.receiptSlicePublicId,
      input.refundPublicId,
      row.receiptPublicId,
      row.amountMinor,
      row.receiptRefundedBeforeMinor,
      row.receiptRefundedAfterMinor,
      row.receiptNetReceivedBeforeMinor,
      row.receiptNetReceivedAfterMinor,
      row.sourceEvidenceSha256,
    )),
    ...input.allocationSlices.map((row) => db.prepare(`
      INSERT INTO canonical_credit_note_refund_allocations (
        tenant_id,allocation_slice_public_id,refund_public_id,receipt_slice_public_id,
        receipt_public_id,allocation_public_id,amount_minor,
        allocation_reversed_before_minor,allocation_reversed_after_minor,
        allocation_remaining_before_minor,allocation_remaining_after_minor,
        balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
    `).bind(
      input.tenantId,
      row.allocationSlicePublicId,
      input.refundPublicId,
      row.receiptSlicePublicId,
      row.receiptPublicId,
      row.allocationPublicId,
      row.amountMinor,
      row.allocationReversedBeforeMinor,
      row.allocationReversedAfterMinor,
      row.allocationRemainingBeforeMinor,
      row.allocationRemainingAfterMinor,
      row.sourceEvidenceSha256,
    )),
    ...input.tenderAttributions.map((row) => db.prepare(`
      INSERT INTO canonical_credit_note_refund_tender_attributions (
        tenant_id,tender_attribution_public_id,refund_public_id,receipt_slice_public_id,
        receipt_public_id,tender_public_id,amount_minor,original_tender_type,
        original_method_code,attributable_before_minor,attributable_after_minor,
        balance_guard,source_evidence_sha256
      )
      SELECT ?,?,?,?,?,?,?,?,?,?,?,1,?
      FROM canonical_payment_tenders t
      WHERE t.tenant_id=?
        AND t.tender_public_id=?
        AND t.receipt_public_id=?
        AND t.status='captured'
        AND t.tender_type=?
        AND t.method_code=?
        AND t.remaining_minor - COALESCE((
          SELECT SUM(attr.amount_minor)
          FROM canonical_credit_note_refund_tender_attributions attr
          INNER JOIN canonical_credit_note_cash_refunds refund
            ON refund.tenant_id=attr.tenant_id
           AND refund.refund_public_id=attr.refund_public_id
          WHERE attr.tenant_id=t.tenant_id
            AND attr.tender_public_id=t.tender_public_id
            AND refund.status='posted'
        ),0)=?
    `).bind(
      input.tenantId,
      row.tenderAttributionPublicId,
      input.refundPublicId,
      row.receiptSlicePublicId,
      row.receiptPublicId,
      row.tenderPublicId,
      row.amountMinor,
      row.tenderType,
      row.methodCode,
      row.attributableBeforeMinor,
      row.attributableAfterMinor,
      row.sourceEvidenceSha256,
      input.tenantId,
      row.tenderPublicId,
      row.receiptPublicId,
      row.tenderType,
      row.methodCode,
      row.attributableBeforeMinor,
    )),
    ...input.allocationSlices.map((row) => db.prepare(`
      UPDATE canonical_payment_allocations
      SET reversed_minor=?,remaining_minor=?,status=?,reversed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND allocation_public_id=?
        AND receipt_public_id=? AND invoice_public_id=? AND status='active'
        AND reversed_minor=? AND remaining_minor=?
    `).bind(
      row.allocationReversedAfterMinor,
      row.allocationRemainingAfterMinor,
      row.allocationRemainingAfterMinor === 0 ? 'reversed' : 'active',
      row.allocationRemainingAfterMinor === 0 ? input.issuedAtUtc : null,
      input.issuedAtUtc,
      input.tenantId,
      row.allocationPublicId,
      row.receiptPublicId,
      input.invoicePublicId,
      row.allocationReversedBeforeMinor,
      row.allocationRemainingBeforeMinor,
    )),
    ...input.receiptSlices.map((row) => db.prepare(`
      UPDATE canonical_payment_receipts
      SET refunded_minor=?,net_received_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND receipt_public_id=? AND status='posted'
        AND refunded_minor=? AND net_received_minor=?
    `).bind(
      row.receiptRefundedAfterMinor,
      row.receiptNetReceivedAfterMinor,
      input.issuedAtUtc,
      input.tenantId,
      row.receiptPublicId,
      row.receiptRefundedBeforeMinor,
      row.receiptNetReceivedBeforeMinor,
    )),
    db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,credited_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
    `).bind(
      invoicePaidAfter,
      invoiceDueAfter,
      invoiceCreditedAfter,
      invoiceNetDueAfter,
      input.issuedAtUtc,
      input.tenantId,
      input.invoicePublicId,
      invoice.paid_minor,
      invoice.due_minor,
      invoice.credited_minor,
      invoice.net_due_minor,
    ),
    db.prepare(`
      UPDATE canonical_credit_notes
      SET reconciliation_guard=CASE WHEN
        total_minor=COALESCE((
          SELECT SUM(amount_minor) FROM canonical_credit_note_lines
          WHERE tenant_id=? AND credit_note_public_id=?
        ),0)
        AND EXISTS (
          SELECT 1 FROM canonical_invoices
          WHERE tenant_id=? AND invoice_public_id=?
            AND paid_minor=? AND due_minor=?
            AND credited_minor=? AND net_due_minor=?
        )
      THEN 1 ELSE 0 END
      WHERE tenant_id=? AND credit_note_public_id=?
    `).bind(
      input.tenantId,
      input.creditNotePublicId,
      input.tenantId,
      input.invoicePublicId,
      invoicePaidAfter,
      invoiceDueAfter,
      invoiceCreditedAfter,
      invoiceNetDueAfter,
      input.tenantId,
      input.creditNotePublicId,
    ),
    db.prepare(`
      UPDATE canonical_credit_note_cash_refunds
      SET reconciliation_guard=CASE WHEN
        amount_minor=COALESCE((
          SELECT SUM(amount_minor)
          FROM canonical_credit_note_refund_receipts
          WHERE tenant_id=? AND refund_public_id=?
        ),0)
        AND amount_minor=COALESCE((
          SELECT SUM(amount_minor)
          FROM canonical_credit_note_refund_allocations
          WHERE tenant_id=? AND refund_public_id=?
        ),0)
        AND amount_minor=COALESCE((
          SELECT SUM(amount_minor)
          FROM canonical_credit_note_refund_tender_attributions
          WHERE tenant_id=? AND refund_public_id=?
        ),0)
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_credit_note_refund_receipts rr
          WHERE rr.tenant_id=? AND rr.refund_public_id=?
            AND (
              rr.amount_minor<>COALESCE((
                SELECT SUM(a.amount_minor)
                FROM canonical_credit_note_refund_allocations a
                WHERE a.tenant_id=rr.tenant_id
                  AND a.refund_public_id=rr.refund_public_id
                  AND a.receipt_slice_public_id=rr.receipt_slice_public_id
              ),0)
              OR rr.amount_minor<>COALESCE((
                SELECT SUM(t.amount_minor)
                FROM canonical_credit_note_refund_tender_attributions t
                WHERE t.tenant_id=rr.tenant_id
                  AND t.refund_public_id=rr.refund_public_id
                  AND t.receipt_slice_public_id=rr.receipt_slice_public_id
              ),0)
              OR NOT EXISTS (
                SELECT 1 FROM canonical_payment_receipts r
                WHERE r.tenant_id=rr.tenant_id
                  AND r.receipt_public_id=rr.receipt_public_id
                  AND r.status='posted'
                  AND r.refunded_minor=rr.receipt_refunded_after_minor
                  AND r.net_received_minor=rr.receipt_net_received_after_minor
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_credit_note_refund_allocations a
          WHERE a.tenant_id=? AND a.refund_public_id=?
            AND NOT EXISTS (
              SELECT 1 FROM canonical_payment_allocations p
              WHERE p.tenant_id=a.tenant_id
                AND p.allocation_public_id=a.allocation_public_id
                AND p.receipt_public_id=a.receipt_public_id
                AND p.invoice_public_id=?
                AND p.reversed_minor=a.allocation_reversed_after_minor
                AND p.remaining_minor=a.allocation_remaining_after_minor
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_credit_note_refund_tender_attributions t
          WHERE t.tenant_id=? AND t.refund_public_id=?
            AND NOT EXISTS (
              SELECT 1
              FROM canonical_payment_tenders p
              WHERE p.tenant_id=t.tenant_id
                AND p.tender_public_id=t.tender_public_id
                AND p.receipt_public_id=t.receipt_public_id
                AND p.status='captured'
                AND p.tender_type=t.original_tender_type
                AND p.method_code=t.original_method_code
                AND p.remaining_minor-COALESCE((
                  SELECT SUM(t2.amount_minor)
                  FROM canonical_credit_note_refund_tender_attributions t2
                  INNER JOIN canonical_credit_note_cash_refunds r2
                    ON r2.tenant_id=t2.tenant_id
                   AND r2.refund_public_id=t2.refund_public_id
                  WHERE t2.tenant_id=p.tenant_id
                    AND t2.tender_public_id=p.tender_public_id
                    AND r2.status='posted'
                ),0)=t.attributable_after_minor
            )
        )
      THEN 1 ELSE 0 END,
      updated_at_utc=?
      WHERE tenant_id=? AND refund_public_id=?
    `).bind(
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.refundPublicId,
      input.tenantId,
      input.refundPublicId,
      input.invoicePublicId,
      input.tenantId,
      input.refundPublicId,
      input.issuedAtUtc,
      input.tenantId,
      input.refundPublicId,
    ),
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      input.cashRefundEventPublicId,
      'canonical_credit_note_cash_refund',
      input.refundPublicId,
      'canonical.credit_note.cash_refunded',
      stableCanonicalJson({
        amountMinor: input.cashRefundMinor,
        creditNotePublicId: input.creditNotePublicId,
        invoicePublicId: input.invoicePublicId,
        payoutMethodCode: input.payoutMethodCode,
        refundPublicId: input.refundPublicId,
      }),
      input.issuedAtUtc,
      input.businessDate,
      `${input.idempotencyKey}:cash-refund`,
    ),
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      input.cashCustodyEventPublicId,
      'canonical_cash_custody',
      input.refundPublicId,
      'canonical.cash_custody.refund_recorded',
      stableCanonicalJson({
        amountMinor: input.cashRefundMinor,
        counterId: input.legacyCounterId,
        counterSessionId: input.legacyCounterSessionId,
        direction: 'out',
        refundPublicId: input.refundPublicId,
      }),
      input.issuedAtUtc,
      input.businessDate,
      `${input.idempotencyKey}:cash-custody`,
    ),
  ];

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.credit_note.cash_refund',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: [
      sourceMappingStatement(db, input, 'credit_note', input.creditNotePublicId, input.sourceEvidenceSha256),
      sourceMappingStatement(db, input, 'credit_note_cash_refund', input.refundPublicId, input.refundSourceEvidenceSha256),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_credit_note',
      aggregatePublicId: input.creditNotePublicId,
      eventType: 'canonical.credit_note.posted',
      occurredAtUtc: input.issuedAtUtc,
      businessDate: input.businessDate,
      payload: {
        cashRefundMinor: input.cashRefundMinor,
        creditNotePublicId: input.creditNotePublicId,
        invoicePublicId: input.invoicePublicId,
        refundPublicId: input.refundPublicId,
        totalMinor,
      },
    },
  });
}
