import {
  listCanonicalIpdAdmissionSummaries,
  type CanonicalIpdAdmissionSummary,
  type CanonicalIpdProjectionDatabase,
} from '../ipd-projection';
import { deriveBusinessDate } from '../time';
import { addSafe, exact, reportingRange, safeNonNegativeInteger } from './common';

export interface CanonicalIpdFinanceFilter {
  startDate: string;
  endDate: string;
  timeZone: string;
  currencyCode: string;
}

export interface CanonicalIpdFinanceInput extends CanonicalIpdFinanceFilter {
  tenantId: string;
  includeCompleted?: boolean;
  includeLegacyComparison?: boolean;
}

export interface CanonicalReportingDifference {
  canonicalMinor: number;
  legacyMinor: number;
  varianceMinor: number;
  classification: 'matched' | 'different';
}

export interface CanonicalIpdFinanceReport {
  rows: CanonicalIpdAdmissionSummary[];
  summary: {
    currencyCode: string;
    admissionCount: number;
    invoicedGrossMinor: number;
    invoicedPaidMinor: number;
    invoicedCreditedMinor: number;
    invoicedNetDueMinor: number;
    unInvoicedServiceMinor: number;
    admissionBalanceMinor: number;
    paymentAllocatedMinor: number;
    depositAppliedMinor: number;
    availableDepositMinor: number;
    paymentReversedMinor: number;
    paymentRefundedMinor: number;
    compensationEarnedMinor: number;
    compensationSettledMinor: number;
    compensationPayableMinor: number;
    issueCount: number;
    legacyMatchedCount: number;
    legacyDifferentCount: number;
  };
  queryContract: {
    source: 'canonical_ipd_projection';
    cardAndDrillDownShareRows: true;
    dateBasis: 'admission_started_at_tenant_business_date';
    readOnly: true;
  };
}

function currency(value: string): string {
  const code = exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(code)) throw new RangeError('currencyCode must use three uppercase letters');
  return code;
}

export function classifyCanonicalReportingDifference(
  canonicalMinor: number,
  legacyMinor: number,
): CanonicalReportingDifference {
  const canonical = safeNonNegativeInteger(canonicalMinor, 'canonical amount');
  const legacy = Number(legacyMinor);
  if (!Number.isSafeInteger(legacy)) throw new RangeError('legacy amount must be a safe integer');
  const varianceMinor = legacy - canonical;
  if (!Number.isSafeInteger(varianceMinor)) throw new RangeError('reporting variance exceeds safe integer range');
  return {
    canonicalMinor: canonical,
    legacyMinor: legacy,
    varianceMinor,
    classification: varianceMinor === 0 ? 'matched' : 'different',
  };
}

export function buildCanonicalIpdFinanceReport(
  sourceRows: readonly CanonicalIpdAdmissionSummary[],
  filter: CanonicalIpdFinanceFilter,
): CanonicalIpdFinanceReport {
  const range = reportingRange(filter.startDate, filter.endDate);
  const timeZone = exact(filter.timeZone, 'timeZone');
  const currencyCode = currency(filter.currencyCode);
  const rows = sourceRows
    .filter((row) => {
      const businessDate = deriveBusinessDate(row.startedAtUtc, timeZone);
      return businessDate >= range.startDate
        && businessDate <= range.endDate
        && row.summary.currencyCode === currencyCode;
    })
    .slice()
    .sort((left, right) => (
      left.startedAtUtc.localeCompare(right.startedAtUtc)
      || left.legacyAdmissionId - right.legacyAdmissionId
    ));

  const summary: CanonicalIpdFinanceReport['summary'] = {
    currencyCode,
    admissionCount: rows.length,
    invoicedGrossMinor: 0,
    invoicedPaidMinor: 0,
    invoicedCreditedMinor: 0,
    invoicedNetDueMinor: 0,
    unInvoicedServiceMinor: 0,
    admissionBalanceMinor: 0,
    paymentAllocatedMinor: 0,
    depositAppliedMinor: 0,
    availableDepositMinor: 0,
    paymentReversedMinor: 0,
    paymentRefundedMinor: 0,
    compensationEarnedMinor: 0,
    compensationSettledMinor: 0,
    compensationPayableMinor: 0,
    issueCount: 0,
    legacyMatchedCount: 0,
    legacyDifferentCount: 0,
  };
  for (const row of rows) {
    const projection = row.summary;
    summary.invoicedGrossMinor = addSafe(summary.invoicedGrossMinor, projection.invoicedGrossMinor, 'IPD invoiced gross');
    summary.invoicedPaidMinor = addSafe(summary.invoicedPaidMinor, projection.invoicedPaidMinor, 'IPD invoiced paid');
    summary.invoicedCreditedMinor = addSafe(summary.invoicedCreditedMinor, projection.invoicedCreditedMinor, 'IPD invoiced credited');
    summary.invoicedNetDueMinor = addSafe(summary.invoicedNetDueMinor, projection.invoicedNetDueMinor, 'IPD invoiced net due');
    summary.unInvoicedServiceMinor = addSafe(
      summary.unInvoicedServiceMinor,
      projection.unInvoicedServiceMinor,
      'IPD un-invoiced service',
    );
    summary.admissionBalanceMinor = addSafe(summary.admissionBalanceMinor, projection.admissionBalanceMinor, 'IPD admission balance');
    summary.paymentAllocatedMinor = addSafe(summary.paymentAllocatedMinor, projection.paymentAllocatedMinor, 'IPD payment allocated');
    summary.depositAppliedMinor = addSafe(summary.depositAppliedMinor, projection.depositAppliedMinor, 'IPD deposit applied');
    summary.availableDepositMinor = addSafe(summary.availableDepositMinor, projection.availableDepositMinor, 'IPD available deposit');
    summary.paymentReversedMinor = addSafe(summary.paymentReversedMinor, projection.paymentReversedMinor, 'IPD payment reversed');
    summary.paymentRefundedMinor = addSafe(summary.paymentRefundedMinor, projection.paymentRefundedMinor, 'IPD payment refunded');
    summary.compensationEarnedMinor = addSafe(
      summary.compensationEarnedMinor,
      projection.compensationEarnedMinor,
      'IPD compensation earned',
    );
    summary.compensationSettledMinor = addSafe(
      summary.compensationSettledMinor,
      projection.compensationSettledMinor,
      'IPD compensation settled',
    );
    summary.compensationPayableMinor = addSafe(
      summary.compensationPayableMinor,
      projection.compensationPayableMinor,
      'IPD compensation payable',
    );
    summary.issueCount = addSafe(summary.issueCount, row.issueCount, 'IPD issue count');
    if (row.legacyComparison?.classification === 'matched') summary.legacyMatchedCount += 1;
    if (row.legacyComparison?.classification === 'different') summary.legacyDifferentCount += 1;
  }

  return {
    rows,
    summary,
    queryContract: {
      source: 'canonical_ipd_projection',
      cardAndDrillDownShareRows: true,
      dateBasis: 'admission_started_at_tenant_business_date',
      readOnly: true,
    },
  };
}

export async function getCanonicalIpdFinanceReport(
  db: CanonicalIpdProjectionDatabase,
  input: CanonicalIpdFinanceInput,
): Promise<CanonicalIpdFinanceReport> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const rows = await listCanonicalIpdAdmissionSummaries(db, {
    tenantId,
    includeCompleted: input.includeCompleted ?? true,
    includeLegacyComparison: input.includeLegacyComparison ?? true,
  });
  return buildCanonicalIpdFinanceReport(rows, input);
}
