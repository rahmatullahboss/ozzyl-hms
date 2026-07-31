import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import { toMinorUnits } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { toUtcIso } from './time';

interface AllStatement extends CanonicalPreparedStatement {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

interface InvoiceMappingRow {
  canonical_public_id: string;
}

interface AllocationRow {
  allocation_public_id: string;
  receipt_public_id: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  received_at_utc: string;
  refunded_minor: number;
  net_received_minor: number;
}

interface TenderRow {
  tender_public_id: string;
  receipt_public_id: string;
  tender_type: CreditNoteOriginalTenderType;
  method_code: string;
  remaining_minor: number;
  prior_attributed_minor: number;
}

export type CreditNoteOriginalTenderType =
  | 'cash'
  | 'card'
  | 'mobile_wallet'
  | 'bank_transfer'
  | 'gateway'
  | 'other';

export interface CreditNoteCashRefundReceiptSlice {
  receiptSlicePublicId: string;
  receiptPublicId: string;
  amountMinor: number;
  receiptRefundedBeforeMinor: number;
  receiptRefundedAfterMinor: number;
  receiptNetReceivedBeforeMinor: number;
  receiptNetReceivedAfterMinor: number;
  sourceEvidenceSha256: string;
}

export interface CreditNoteCashRefundAllocationSlice {
  allocationSlicePublicId: string;
  receiptSlicePublicId: string;
  receiptPublicId: string;
  allocationPublicId: string;
  amountMinor: number;
  allocationReversedBeforeMinor: number;
  allocationReversedAfterMinor: number;
  allocationRemainingBeforeMinor: number;
  allocationRemainingAfterMinor: number;
  sourceEvidenceSha256: string;
}

export interface CreditNoteCashRefundTenderAttribution {
  tenderAttributionPublicId: string;
  receiptSlicePublicId: string;
  receiptPublicId: string;
  tenderPublicId: string;
  amountMinor: number;
  tenderType: CreditNoteOriginalTenderType;
  methodCode: string;
  attributableBeforeMinor: number;
  attributableAfterMinor: number;
  sourceEvidenceSha256: string;
}

export interface CreditNoteCashRefundFundingPlan {
  tenantId: string;
  invoicePublicId: string;
  refundPublicId: string;
  amountMinor: number;
  refundedAtUtc: string;
  sourceEvidenceSha256: string;
  receiptSlices: readonly CreditNoteCashRefundReceiptSlice[];
  allocationSlices: readonly CreditNoteCashRefundAllocationSlice[];
  tenderAttributions: readonly CreditNoteCashRefundTenderAttribution[];
}

export interface LiveCreditNoteCashRefundAuthority {
  tenantId: string;
  creditNoteNo: string;
  billId: number;
  billInvoiceNo: string;
  cashRefund: string | number;
  refundedAtUtc: string;
}

interface ReceiptAuthority {
  receiptPublicId: string;
  receivedAtUtc: string;
  refundedMinor: number;
  netReceivedMinor: number;
  allocations: AllocationRow[];
  tenders: Array<TenderRow & { attributableMinor: number }>;
  availableMinor: number;
  hasCash: boolean;
}

const TENDER_ORDER: Record<CreditNoteOriginalTenderType, number> = {
  cash: 0,
  card: 1,
  mobile_wallet: 2,
  bank_transfer: 3,
  gateway: 4,
  other: 5,
};

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return number;
}

function positiveMinor(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return number;
}

async function allRows<T>(
  db: CanonicalBatchDatabase,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const statement = db.prepare(sql).bind(...params) as AllStatement;
  if (typeof statement.all !== 'function') {
    throw new TypeError('Canonical cash-refund resolver requires a query adapter with all()');
  }
  const result = await statement.all<T>();
  return Array.isArray(result.results) ? result.results : [];
}

async function loadInvoicePublicId(
  db: CanonicalBatchDatabase,
  authority: LiveCreditNoteCashRefundAuthority,
): Promise<string> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND mapping_status='mapped'
      AND (
        (source_type='legacy_live_bill' AND source_public_id=?)
        OR (source_type='legacy_bill' AND source_public_id=?)
      )
    ORDER BY CASE source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END
    LIMIT 1
  `).bind(
    authority.tenantId,
    authority.billInvoiceNo,
    String(authority.billId),
  ).first<InvoiceMappingRow>();
  if (!mapping?.canonical_public_id) throw new Error('Canonical invoice mapping not found');
  return exact(mapping.canonical_public_id, 'canonical invoice mapping');
}

async function loadReceiptAuthorities(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<ReceiptAuthority[]> {
  const allocationRows = await allRows<AllocationRow>(db, `
    SELECT
      a.allocation_public_id,
      a.receipt_public_id,
      a.amount_minor,
      a.reversed_minor,
      a.remaining_minor,
      r.received_at_utc,
      r.refunded_minor,
      r.net_received_minor
    FROM canonical_payment_allocations a
    INNER JOIN canonical_payment_receipts r
      ON r.tenant_id=a.tenant_id AND r.receipt_public_id=a.receipt_public_id
    WHERE a.tenant_id=?
      AND a.invoice_public_id=?
      AND a.status='active'
      AND a.remaining_minor>0
      AND r.status='posted'
      AND r.net_received_minor>0
  `, tenantId, invoicePublicId);

  const tenderRows = await allRows<TenderRow>(db, `
    SELECT
      t.tender_public_id,
      t.receipt_public_id,
      t.tender_type,
      t.method_code,
      t.remaining_minor,
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
    WHERE t.tenant_id=?
      AND t.status='captured'
      AND t.remaining_minor>0
      AND EXISTS (
        SELECT 1
        FROM canonical_payment_allocations a
        WHERE a.tenant_id=t.tenant_id
          AND a.receipt_public_id=t.receipt_public_id
          AND a.invoice_public_id=?
          AND a.status='active'
          AND a.remaining_minor>0
      )
  `, tenantId, invoicePublicId);

  const tendersByReceipt = new Map<string, ReceiptAuthority['tenders']>();
  for (const row of tenderRows) {
    const remainingMinor = positiveMinor(row.remaining_minor, 'tender.remaining_minor');
    const priorAttributedMinor = nonNegativeInteger(
      row.prior_attributed_minor,
      'tender.prior_attributed_minor',
    );
    const attributableMinor = remainingMinor - priorAttributedMinor;
    if (attributableMinor <= 0) continue;
    const tenderType = exact(String(row.tender_type), 'tender.tender_type') as CreditNoteOriginalTenderType;
    if (!(tenderType in TENDER_ORDER)) throw new Error('Canonical payment tender type is unsupported');
    const normalized = {
      ...row,
      tender_type: tenderType,
      remaining_minor: remainingMinor,
      prior_attributed_minor: priorAttributedMinor,
      attributableMinor,
    };
    const rows = tendersByReceipt.get(row.receipt_public_id) ?? [];
    rows.push(normalized);
    tendersByReceipt.set(row.receipt_public_id, rows);
  }

  const receipts = new Map<string, ReceiptAuthority>();
  for (const row of allocationRows) {
    const receiptPublicId = exact(row.receipt_public_id, 'allocation.receipt_public_id');
    const allocation: AllocationRow = {
      ...row,
      allocation_public_id: exact(row.allocation_public_id, 'allocation.allocation_public_id'),
      amount_minor: positiveMinor(row.amount_minor, 'allocation.amount_minor'),
      reversed_minor: nonNegativeInteger(row.reversed_minor, 'allocation.reversed_minor'),
      remaining_minor: positiveMinor(row.remaining_minor, 'allocation.remaining_minor'),
      refunded_minor: nonNegativeInteger(row.refunded_minor, 'receipt.refunded_minor'),
      net_received_minor: positiveMinor(row.net_received_minor, 'receipt.net_received_minor'),
      received_at_utc: toUtcIso(exact(row.received_at_utc, 'receipt.received_at_utc')),
    };
    const existing = receipts.get(receiptPublicId);
    if (existing) {
      if (
        existing.receivedAtUtc !== allocation.received_at_utc
        || existing.refundedMinor !== allocation.refunded_minor
        || existing.netReceivedMinor !== allocation.net_received_minor
      ) {
        throw new Error('Canonical payment receipt authority is inconsistent');
      }
      existing.allocations.push(allocation);
      continue;
    }
    receipts.set(receiptPublicId, {
      receiptPublicId,
      receivedAtUtc: allocation.received_at_utc,
      refundedMinor: allocation.refunded_minor,
      netReceivedMinor: allocation.net_received_minor,
      allocations: [allocation],
      tenders: tendersByReceipt.get(receiptPublicId) ?? [],
      availableMinor: 0,
      hasCash: false,
    });
  }

  const result: ReceiptAuthority[] = [];
  for (const receipt of receipts.values()) {
    receipt.allocations.sort((left, right) => (
      right.allocation_public_id.localeCompare(left.allocation_public_id)
    ));
    receipt.tenders.sort((left, right) => (
      TENDER_ORDER[left.tender_type] - TENDER_ORDER[right.tender_type]
      || left.tender_public_id.localeCompare(right.tender_public_id)
    ));
    const allocationAvailable = receipt.allocations.reduce(
      (sum, row) => sum + row.remaining_minor,
      0,
    );
    const tenderAvailable = receipt.tenders.reduce(
      (sum, row) => sum + row.attributableMinor,
      0,
    );
    receipt.availableMinor = Math.min(
      allocationAvailable,
      tenderAvailable,
      receipt.netReceivedMinor,
    );
    receipt.hasCash = receipt.tenders.some(
      (row) => row.tender_type === 'cash' && row.attributableMinor > 0,
    );
    if (receipt.availableMinor > 0) result.push(receipt);
  }

  result.sort((left, right) => (
    Number(right.hasCash) - Number(left.hasCash)
    || right.receivedAtUtc.localeCompare(left.receivedAtUtc)
    || right.receiptPublicId.localeCompare(left.receiptPublicId)
  ));
  return result;
}

export async function resolveLiveCreditNoteCashRefundFunding(
  db: CanonicalBatchDatabase,
  authority: LiveCreditNoteCashRefundAuthority,
): Promise<CreditNoteCashRefundFundingPlan> {
  const tenantId = exact(authority.tenantId, 'tenantId');
  const creditNoteNo = exact(authority.creditNoteNo, 'creditNoteNo');
  positiveInteger(authority.billId, 'billId');
  exact(authority.billInvoiceNo, 'billInvoiceNo');
  const refundedAtUtc = toUtcIso(exact(authority.refundedAtUtc, 'refundedAtUtc'));
  const amountMinor = positiveMinor(toMinorUnits(authority.cashRefund), 'cashRefund');
  const invoicePublicId = await loadInvoicePublicId(db, authority);
  const receiptAuthorities = await loadReceiptAuthorities(db, tenantId, invoicePublicId);
  const refundPublicId = await createDeterministicSourceId(
    'crrefund',
    tenantId,
    'legacy_live_credit_note_cash_refund',
    creditNoteNo,
  );

  const receiptSlices: CreditNoteCashRefundReceiptSlice[] = [];
  const allocationSlices: CreditNoteCashRefundAllocationSlice[] = [];
  const tenderAttributions: CreditNoteCashRefundTenderAttribution[] = [];
  let remainingMinor = amountMinor;

  for (const receipt of receiptAuthorities) {
    if (remainingMinor === 0) break;
    const receiptAmountMinor = Math.min(remainingMinor, receipt.availableMinor);
    if (receiptAmountMinor <= 0) continue;
    const receiptSlicePublicId = await createDeterministicSourceId(
      'crrecpt',
      tenantId,
      'credit_note_cash_refund_receipt',
      `${creditNoteNo}:${receipt.receiptPublicId}`,
    );
    const receiptEvidence = await createSourceEvidenceSha256({
      creditNoteNo,
      invoicePublicId,
      receiptPublicId: receipt.receiptPublicId,
      amountMinor: receiptAmountMinor,
      refundedBeforeMinor: receipt.refundedMinor,
      netReceivedBeforeMinor: receipt.netReceivedMinor,
    });
    receiptSlices.push({
      receiptSlicePublicId,
      receiptPublicId: receipt.receiptPublicId,
      amountMinor: receiptAmountMinor,
      receiptRefundedBeforeMinor: receipt.refundedMinor,
      receiptRefundedAfterMinor: receipt.refundedMinor + receiptAmountMinor,
      receiptNetReceivedBeforeMinor: receipt.netReceivedMinor,
      receiptNetReceivedAfterMinor: receipt.netReceivedMinor - receiptAmountMinor,
      sourceEvidenceSha256: receiptEvidence,
    });

    let allocationRemainingMinor = receiptAmountMinor;
    for (const allocation of receipt.allocations) {
      if (allocationRemainingMinor === 0) break;
      const sliceAmountMinor = Math.min(
        allocationRemainingMinor,
        allocation.remaining_minor,
      );
      if (sliceAmountMinor <= 0) continue;
      const allocationSlicePublicId = await createDeterministicSourceId(
        'cralloc',
        tenantId,
        'credit_note_cash_refund_allocation',
        `${creditNoteNo}:${allocation.allocation_public_id}`,
      );
      allocationSlices.push({
        allocationSlicePublicId,
        receiptSlicePublicId,
        receiptPublicId: receipt.receiptPublicId,
        allocationPublicId: allocation.allocation_public_id,
        amountMinor: sliceAmountMinor,
        allocationReversedBeforeMinor: allocation.reversed_minor,
        allocationReversedAfterMinor: allocation.reversed_minor + sliceAmountMinor,
        allocationRemainingBeforeMinor: allocation.remaining_minor,
        allocationRemainingAfterMinor: allocation.remaining_minor - sliceAmountMinor,
        sourceEvidenceSha256: await createSourceEvidenceSha256({
          creditNoteNo,
          receiptPublicId: receipt.receiptPublicId,
          allocationPublicId: allocation.allocation_public_id,
          amountMinor: sliceAmountMinor,
          reversedBeforeMinor: allocation.reversed_minor,
          remainingBeforeMinor: allocation.remaining_minor,
        }),
      });
      allocationRemainingMinor -= sliceAmountMinor;
    }
    if (allocationRemainingMinor !== 0) {
      throw new Error('Insufficient canonical payment funding for cash refund');
    }

    let tenderRemainingMinor = receiptAmountMinor;
    for (const tender of receipt.tenders) {
      if (tenderRemainingMinor === 0) break;
      const sliceAmountMinor = Math.min(tenderRemainingMinor, tender.attributableMinor);
      if (sliceAmountMinor <= 0) continue;
      const tenderAttributionPublicId = await createDeterministicSourceId(
        'crtender',
        tenantId,
        'credit_note_cash_refund_tender',
        `${creditNoteNo}:${tender.tender_public_id}`,
      );
      tenderAttributions.push({
        tenderAttributionPublicId,
        receiptSlicePublicId,
        receiptPublicId: receipt.receiptPublicId,
        tenderPublicId: tender.tender_public_id,
        amountMinor: sliceAmountMinor,
        tenderType: tender.tender_type,
        methodCode: exact(tender.method_code, 'tender.method_code'),
        attributableBeforeMinor: tender.attributableMinor,
        attributableAfterMinor: tender.attributableMinor - sliceAmountMinor,
        sourceEvidenceSha256: await createSourceEvidenceSha256({
          creditNoteNo,
          receiptPublicId: receipt.receiptPublicId,
          tenderPublicId: tender.tender_public_id,
          tenderType: tender.tender_type,
          methodCode: tender.method_code,
          amountMinor: sliceAmountMinor,
          remainingMinor: tender.remaining_minor,
          priorAttributedMinor: tender.prior_attributed_minor,
        }),
      });
      tenderRemainingMinor -= sliceAmountMinor;
    }
    if (tenderRemainingMinor !== 0) {
      throw new Error('Insufficient canonical payment funding for cash refund');
    }
    remainingMinor -= receiptAmountMinor;
  }

  if (remainingMinor !== 0) {
    throw new Error('Insufficient canonical payment funding for cash refund');
  }

  const receiptTotal = receiptSlices.reduce((sum, row) => sum + row.amountMinor, 0);
  const allocationTotal = allocationSlices.reduce((sum, row) => sum + row.amountMinor, 0);
  const tenderTotal = tenderAttributions.reduce((sum, row) => sum + row.amountMinor, 0);
  if (
    receiptTotal !== amountMinor
    || allocationTotal !== amountMinor
    || tenderTotal !== amountMinor
  ) {
    throw new Error('Canonical cash-refund attribution does not reconcile');
  }

  const sourceEvidenceSha256 = await createSourceEvidenceSha256({
    tenantId,
    creditNoteNo,
    invoicePublicId,
    amountMinor,
    refundedAtUtc,
    receiptSlices,
    allocationSlices,
    tenderAttributions,
  });

  return {
    tenantId,
    invoicePublicId,
    refundPublicId,
    amountMinor,
    refundedAtUtc,
    sourceEvidenceSha256,
    receiptSlices,
    allocationSlices,
    tenderAttributions,
  };
}
