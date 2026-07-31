import { deriveBusinessDate } from '../time';
import {
  addSafe,
  all,
  exact,
  reportingRange,
  safeNonNegativeInteger,
  type CanonicalReportingDatabase,
} from './common';

export interface CanonicalCollectionsInput {
  tenantId: string;
  startDate: string;
  endDate: string;
  currencyCode: string;
  timeZone: string;
}

export type CanonicalCollectionContributionType =
  | 'receipt'
  | 'allocation'
  | 'deposit_application'
  | 'credit_note'
  | 'refund'
  | 'payment_reversal';

export interface CanonicalCollectionContributionRow {
  contributionPublicId: string;
  contributionType: CanonicalCollectionContributionType;
  businessDate: string;
  currencyCode: string;
  receiptPublicId: string | null;
  invoicePublicId: string | null;
  invoiceLinePublicId: string | null;
  grossReceivedMinor: number;
  netReceivedMinor: number;
  allocatedMinor: number;
  serviceAllocatedMinor: number;
  unallocatedLiabilityMinor: number;
  depositAppliedMinor: number;
  creditedMinor: number;
  refundedMinor: number;
  paymentReversedMinor: number;
  tenderCount: number;
}

export interface CanonicalCollectionsReport {
  rows: CanonicalCollectionContributionRow[];
  summary: {
    currencyCode: string;
    grossReceivedMinor: number;
    netReceivedMinor: number;
    allocatedMinor: number;
    serviceAllocatedMinor: number;
    invoiceOnlyAllocatedMinor: number;
    unallocatedLiabilityMinor: number;
    depositAppliedMinor: number;
    creditedMinor: number;
    refundedMinor: number;
    paymentReversedMinor: number;
  };
  queryContract: {
    allocationSource: 'persisted_canonical_payment_allocations_remaining_minor';
    proportionalAllocationUsed: false;
    receiptIdentity: 'one_row_per_receipt_not_per_tender';
    readOnly: true;
  };
}

interface ReceiptRow {
  receipt_public_id: string;
  business_date: string;
  currency_code: string;
  total_minor: number;
  net_received_minor: number;
  unallocated_minor: number;
  tender_count: number;
}

interface AllocationRow {
  allocation_public_id: string;
  receipt_public_id: string;
  invoice_public_id: string;
  invoice_line_public_id: string | null;
  business_date: string;
  currency_code: string;
  remaining_minor: number;
}

interface DepositApplicationRow {
  application_public_id: string;
  invoice_public_id: string;
  invoice_line_public_id: string | null;
  applied_at_utc: string;
  currency_code: string;
  amount_minor: number;
}

interface CreditRow {
  credit_note_public_id: string;
  invoice_public_id: string;
  business_date: string;
  currency_code: string;
  total_minor: number;
}

interface RefundRow {
  refund_public_id: string;
  receipt_public_id: string | null;
  business_date: string;
  currency_code: string;
  amount_minor: number;
}

interface ReversalRow {
  reversal_public_id: string;
  receipt_public_id: string;
  invoice_public_id: string;
  allocation_public_id: string;
  business_date: string;
  currency_code: string;
  amount_minor: number;
}

function currency(value: string): string {
  const code = exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(code)) throw new RangeError('currencyCode must use three uppercase letters');
  return code;
}

function emptyRow(
  contributionPublicId: string,
  contributionType: CanonicalCollectionContributionType,
  businessDate: string,
  currencyCode: string,
): CanonicalCollectionContributionRow {
  return {
    contributionPublicId,
    contributionType,
    businessDate,
    currencyCode,
    receiptPublicId: null,
    invoicePublicId: null,
    invoiceLinePublicId: null,
    grossReceivedMinor: 0,
    netReceivedMinor: 0,
    allocatedMinor: 0,
    serviceAllocatedMinor: 0,
    unallocatedLiabilityMinor: 0,
    depositAppliedMinor: 0,
    creditedMinor: 0,
    refundedMinor: 0,
    paymentReversedMinor: 0,
    tenderCount: 0,
  };
}

function isDateInRange(value: string, startDate: string, endDate: string): boolean {
  return value >= startDate && value <= endDate;
}

export async function getCanonicalCollectionsReport(
  db: CanonicalReportingDatabase,
  input: CanonicalCollectionsInput,
): Promise<CanonicalCollectionsReport> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const range = reportingRange(input.startDate, input.endDate);
  const currencyCode = currency(input.currencyCode);
  const timeZone = exact(input.timeZone, 'timeZone');

  const receipts = await all<ReceiptRow>(db.prepare(`
    SELECT
      r.receipt_public_id,
      r.business_date,
      r.currency_code,
      r.total_minor,
      r.net_received_minor,
      r.unallocated_minor,
      (
        SELECT COUNT(*)
        FROM canonical_payment_tenders t
        WHERE t.tenant_id=r.tenant_id
          AND t.receipt_public_id=r.receipt_public_id
          AND t.captured_at_utc IS NOT NULL
      ) tender_count
    FROM canonical_payment_receipts r
    WHERE r.tenant_id=?
      AND r.currency_code=?
      AND r.status IN ('posted','reversed')
      AND r.business_date>=?
      AND r.business_date<=?
    ORDER BY r.business_date,r.receipt_public_id
  `).bind(tenantId, currencyCode, range.startDate, range.endDate));

  const allocations = await all<AllocationRow>(db.prepare(`
    SELECT
      a.allocation_public_id,
      a.receipt_public_id,
      a.invoice_public_id,
      a.invoice_line_public_id,
      r.business_date,
      r.currency_code,
      a.remaining_minor
    FROM canonical_payment_allocations a
    JOIN canonical_payment_receipts r
      ON r.tenant_id=a.tenant_id AND r.receipt_public_id=a.receipt_public_id
    WHERE a.tenant_id=?
      AND r.currency_code=?
      AND a.status='active'
      AND r.business_date>=?
      AND r.business_date<=?
    ORDER BY r.business_date,a.allocation_public_id
  `).bind(tenantId, currencyCode, range.startDate, range.endDate));

  const depositApplications = await all<DepositApplicationRow>(db.prepare(`
    SELECT
      a.application_public_id,
      a.invoice_public_id,
      a.invoice_line_public_id,
      a.applied_at_utc,
      d.currency_code,
      a.amount_minor
    FROM canonical_deposit_applications a
    JOIN canonical_deposits d
      ON d.tenant_id=a.tenant_id AND d.deposit_public_id=a.deposit_public_id
    WHERE a.tenant_id=?
      AND d.currency_code=?
      AND a.status='active'
    ORDER BY a.applied_at_utc,a.application_public_id
  `).bind(tenantId, currencyCode));

  const credits = await all<CreditRow>(db.prepare(`
    SELECT credit_note_public_id,invoice_public_id,business_date,currency_code,total_minor
    FROM canonical_credit_notes
    WHERE tenant_id=? AND currency_code=? AND status='posted'
      AND business_date>=? AND business_date<=?
    ORDER BY business_date,credit_note_public_id
  `).bind(tenantId, currencyCode, range.startDate, range.endDate));

  const refunds = await all<RefundRow>(db.prepare(`
    SELECT
      r.refund_public_id,
      r.receipt_public_id,
      r.business_date,
      COALESCE(d.currency_code,pr.currency_code) currency_code,
      r.amount_minor
    FROM canonical_refunds r
    LEFT JOIN canonical_deposits d
      ON d.tenant_id=r.tenant_id AND d.deposit_public_id=r.deposit_public_id
    LEFT JOIN canonical_payment_receipts pr
      ON pr.tenant_id=r.tenant_id AND pr.receipt_public_id=r.receipt_public_id
    WHERE r.tenant_id=?
      AND r.status='posted'
      AND COALESCE(d.currency_code,pr.currency_code)=?
      AND r.business_date>=?
      AND r.business_date<=?
    ORDER BY r.business_date,r.refund_public_id
  `).bind(tenantId, currencyCode, range.startDate, range.endDate));

  const reversals = await all<ReversalRow>(db.prepare(`
    SELECT
      pr.reversal_public_id,
      pr.receipt_public_id,
      pr.invoice_public_id,
      pr.allocation_public_id,
      pr.business_date,
      r.currency_code,
      pr.amount_minor
    FROM canonical_payment_reversals pr
    JOIN canonical_payment_receipts r
      ON r.tenant_id=pr.tenant_id AND r.receipt_public_id=pr.receipt_public_id
    WHERE pr.tenant_id=?
      AND r.currency_code=?
      AND pr.status='posted'
      AND pr.business_date>=?
      AND pr.business_date<=?
    ORDER BY pr.business_date,pr.reversal_public_id
  `).bind(tenantId, currencyCode, range.startDate, range.endDate));

  const rows: CanonicalCollectionContributionRow[] = [];
  for (const receipt of receipts) {
    const row = emptyRow(receipt.receipt_public_id, 'receipt', receipt.business_date, receipt.currency_code);
    row.receiptPublicId = receipt.receipt_public_id;
    row.grossReceivedMinor = safeNonNegativeInteger(receipt.total_minor, 'receipt total');
    row.netReceivedMinor = safeNonNegativeInteger(receipt.net_received_minor, 'receipt net received');
    row.unallocatedLiabilityMinor = safeNonNegativeInteger(receipt.unallocated_minor, 'receipt unallocated');
    row.tenderCount = safeNonNegativeInteger(receipt.tender_count, 'receipt tender count');
    if (row.netReceivedMinor > row.grossReceivedMinor) throw new RangeError('Receipt net received cannot exceed gross receipt amount');
    rows.push(row);
  }
  for (const allocation of allocations) {
    const row = emptyRow(
      allocation.allocation_public_id,
      'allocation',
      allocation.business_date,
      allocation.currency_code,
    );
    row.receiptPublicId = allocation.receipt_public_id;
    row.invoicePublicId = allocation.invoice_public_id;
    row.invoiceLinePublicId = allocation.invoice_line_public_id;
    row.allocatedMinor = safeNonNegativeInteger(allocation.remaining_minor, 'active allocation remaining amount');
    row.serviceAllocatedMinor = allocation.invoice_line_public_id ? row.allocatedMinor : 0;
    rows.push(row);
  }
  for (const application of depositApplications) {
    const businessDate = deriveBusinessDate(application.applied_at_utc, timeZone);
    if (!isDateInRange(businessDate, range.startDate, range.endDate)) continue;
    const row = emptyRow(application.application_public_id, 'deposit_application', businessDate, application.currency_code);
    row.invoicePublicId = application.invoice_public_id;
    row.invoiceLinePublicId = application.invoice_line_public_id;
    row.depositAppliedMinor = safeNonNegativeInteger(application.amount_minor, 'deposit application amount');
    rows.push(row);
  }
  for (const credit of credits) {
    const row = emptyRow(credit.credit_note_public_id, 'credit_note', credit.business_date, credit.currency_code);
    row.invoicePublicId = credit.invoice_public_id;
    row.creditedMinor = safeNonNegativeInteger(credit.total_minor, 'credit note amount');
    rows.push(row);
  }
  for (const refund of refunds) {
    const row = emptyRow(refund.refund_public_id, 'refund', refund.business_date, refund.currency_code);
    row.receiptPublicId = refund.receipt_public_id;
    row.refundedMinor = safeNonNegativeInteger(refund.amount_minor, 'refund amount');
    rows.push(row);
  }
  for (const reversal of reversals) {
    const row = emptyRow(reversal.reversal_public_id, 'payment_reversal', reversal.business_date, reversal.currency_code);
    row.receiptPublicId = reversal.receipt_public_id;
    row.invoicePublicId = reversal.invoice_public_id;
    row.paymentReversedMinor = safeNonNegativeInteger(reversal.amount_minor, 'payment reversal amount');
    rows.push(row);
  }

  rows.sort((left, right) => (
    left.businessDate.localeCompare(right.businessDate)
    || left.contributionType.localeCompare(right.contributionType)
    || left.contributionPublicId.localeCompare(right.contributionPublicId)
  ));

  const summary: CanonicalCollectionsReport['summary'] = {
    currencyCode,
    grossReceivedMinor: 0,
    netReceivedMinor: 0,
    allocatedMinor: 0,
    serviceAllocatedMinor: 0,
    invoiceOnlyAllocatedMinor: 0,
    unallocatedLiabilityMinor: 0,
    depositAppliedMinor: 0,
    creditedMinor: 0,
    refundedMinor: 0,
    paymentReversedMinor: 0,
  };
  for (const row of rows) {
    summary.grossReceivedMinor = addSafe(summary.grossReceivedMinor, row.grossReceivedMinor, 'gross collection summary');
    summary.netReceivedMinor = addSafe(summary.netReceivedMinor, row.netReceivedMinor, 'net collection summary');
    summary.allocatedMinor = addSafe(summary.allocatedMinor, row.allocatedMinor, 'allocation summary');
    summary.serviceAllocatedMinor = addSafe(
      summary.serviceAllocatedMinor,
      row.serviceAllocatedMinor,
      'service allocation summary',
    );
    summary.unallocatedLiabilityMinor = addSafe(
      summary.unallocatedLiabilityMinor,
      row.unallocatedLiabilityMinor,
      'unallocated liability summary',
    );
    summary.depositAppliedMinor = addSafe(summary.depositAppliedMinor, row.depositAppliedMinor, 'deposit applied summary');
    summary.creditedMinor = addSafe(summary.creditedMinor, row.creditedMinor, 'credit summary');
    summary.refundedMinor = addSafe(summary.refundedMinor, row.refundedMinor, 'refund summary');
    summary.paymentReversedMinor = addSafe(
      summary.paymentReversedMinor,
      row.paymentReversedMinor,
      'payment reversal summary',
    );
  }
  summary.invoiceOnlyAllocatedMinor = summary.allocatedMinor - summary.serviceAllocatedMinor;
  if (!Number.isSafeInteger(summary.invoiceOnlyAllocatedMinor) || summary.invoiceOnlyAllocatedMinor < 0) {
    throw new RangeError('Persisted collection allocations do not reconcile safely');
  }

  return {
    rows,
    summary,
    queryContract: {
      allocationSource: 'persisted_canonical_payment_allocations_remaining_minor',
      proportionalAllocationUsed: false,
      receiptIdentity: 'one_row_per_receipt_not_per_tender',
      readOnly: true,
    },
  };
}
