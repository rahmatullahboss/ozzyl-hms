import type { ExecutiveDashboardPeriod } from '../../executive-dashboard-period';
import type {
  DoctorAnalyticsQueryContract,
  DoctorCommissionDetailRow,
  DoctorPerformanceDetailsResponse,
  DoctorPerformanceDetailsSummary,
  DoctorPerformanceDetailsTab,
  DoctorPerformanceResponse,
  DoctorPerformanceRow,
  DoctorPerformanceSort,
  DoctorPerformanceSortDirection,
  DoctorTestDetailRow,
  DoctorVisitDetailRow,
} from '../../executive-doctor-analytics';
import {
  commissionReasonLabel,
  resolveCommissionReasonCode,
} from '../../../services/dashboard/doctorReportingContract';

export interface CanonicalExecutiveDoctorAnalyticsPreparedStatement {
  bind(...values: unknown[]): CanonicalExecutiveDoctorAnalyticsPreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

export interface CanonicalExecutiveDoctorAnalyticsDatabase {
  prepare(sql: string): CanonicalExecutiveDoctorAnalyticsPreparedStatement;
}

const CANONICAL_QUERY_CONTRACT: DoctorAnalyticsQueryContract = {
  contractVersion: 'doctor-compensation-v1',
  dataSource: 'canonical',
  moneyUnit: 'major',
  currencyCode: 'BDT',
  dateBasis: 'tenant-business-date-asia-dhaka',
  cutoverPolicy: 'explicit-provider-switch',
};

type CanonicalDoctorFactRow = {
  id: number | string;
  accrual_public_id: string;
  invoice_public_id: string;
  invoice_line_public_id: string;
  practitioner_public_id: string | null;
  practitioner_role: string;
  accrual_stage: string;
  rule_public_id: string;
  rule_version: number | string;
  rate_type: string;
  rate_value: number | string;
  currency_code: string;
  gross_minor: number | string;
  discount_minor: number | string;
  performer_reserve_minor: number | string;
  eligible_base_minor: number | string;
  earned_minor: number | string;
  adjusted_minor: number | string;
  settled_minor: number | string;
  payable_minor: number | string;
  status: string;
  accrued_at_utc: string;
  business_date: string;
  source_kind: string | null;
  incentive_type: string | null;
  legacy_bill_id: number | string | null;
  legacy_invoice_item_id: number | string | null;
  legacy_lab_order_item_id: number | string | null;
  detail_name: string | null;
  source_reference: string | null;
  waiver_reason: string | null;
  doctor_waiver_minor: number | string | null;
  refund_reserved_base_minor: number | string | null;
  refund_reserved_earned_minor: number | string | null;
  refund_reserved_waiver_minor: number | string | null;
  refund_reserved_payable_minor: number | string | null;
  doctor_id: number | string | null;
  doctor_name: string | null;
  invoice_number: string | null;
  legacy_patient_id: number | string | null;
  invoice_status: string | null;
  line_collected_minor: number | string | null;
  settlement_number: string | null;
};

type CanonicalDoctorFact = {
  id: number;
  accrualPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId: string;
  practitionerPublicId: string | null;
  practitionerRole: string;
  accrualStage: string;
  rulePublicId: string;
  ruleVersion: number;
  rateType: string;
  rateValue: number;
  grossMinor: number;
  discountMinor: number;
  performerReserveMinor: number;
  eligibleBaseMinor: number;
  earnedMinor: number;
  adjustedMinor: number;
  doctorWaiverMinor: number;
  settledMinor: number;
  canonicalPayableMinor: number;
  payableBeforeSettlementMinor: number;
  paidMinor: number;
  outstandingMinor: number;
  status: string;
  accruedAtUtc: string;
  businessDate: string;
  sourceKind: string;
  incentiveType: string | null;
  legacyBillId: number | null;
  legacyInvoiceItemId: number | null;
  legacyLabOrderItemId: number | null;
  detailName: string | null;
  sourceReference: string | null;
  waiverReason: string | null;
  doctorId: number | null;
  doctorName: string;
  invoiceNumber: string | null;
  legacyPatientId: number | null;
  invoiceStatus: string | null;
  lineCollectedMinor: number;
  settlementNumber: string | null;
};

type RowAccumulator = {
  row: DoctorPerformanceRow;
  referredLines: Map<string, CanonicalDoctorFact>;
  performedLines: Map<string, CanonicalDoctorFact>;
  visitLines: Map<string, CanonicalDoctorFact>;
};

const FACT_SQL = `
  SELECT
    a.id,
    a.accrual_public_id,
    a.invoice_public_id,
    a.invoice_line_public_id,
    a.practitioner_public_id,
    a.practitioner_role,
    a.accrual_stage,
    a.rule_public_id,
    a.rule_version,
    a.rate_type,
    a.rate_value,
    a.currency_code,
    a.gross_minor,
    a.discount_minor,
    a.performer_reserve_minor,
    a.eligible_base_minor,
    a.earned_minor,
    a.adjusted_minor,
    a.settled_minor,
    a.payable_minor,
    a.status,
    a.accrued_at_utc,
    a.business_date,
    ctx.source_kind,
    ctx.incentive_type,
    ctx.legacy_bill_id,
    ctx.legacy_invoice_item_id,
    ctx.legacy_lab_order_item_id,
    ctx.detail_name,
    ctx.source_reference,
    ctx.waiver_reason,
    ctx.doctor_waiver_minor,
    refund_reservation.reserved_base_minor AS refund_reserved_base_minor,
    refund_reservation.reserved_earned_minor AS refund_reserved_earned_minor,
    refund_reservation.reserved_waiver_minor AS refund_reserved_waiver_minor,
    refund_reservation.reserved_payable_minor AS refund_reserved_payable_minor,
    CASE
      WHEN a.practitioner_public_id IS NULL THEN NULL
      ELSE (
        SELECT CAST(mapping.source_public_id AS INTEGER)
        FROM canonical_source_mappings mapping
        WHERE mapping.tenant_id=a.tenant_id
          AND mapping.entity_type='practitioner'
          AND mapping.canonical_public_id=a.practitioner_public_id
          AND mapping.source_type='legacy_doctor'
          AND mapping.mapping_status='mapped'
        ORDER BY mapping.id ASC
        LIMIT 1
      )
    END AS doctor_id,
    practitioner.display_name AS doctor_name,
    invoice.invoice_number,
    invoice.legacy_patient_id,
    invoice.status AS invoice_status,
    COALESCE((
      SELECT SUM(allocation.remaining_minor)
      FROM canonical_payment_allocations allocation
      JOIN canonical_payment_receipts receipt
        ON receipt.tenant_id=allocation.tenant_id
       AND receipt.receipt_public_id=allocation.receipt_public_id
      WHERE allocation.tenant_id=a.tenant_id
        AND allocation.invoice_public_id=a.invoice_public_id
        AND allocation.invoice_line_public_id=a.invoice_line_public_id
        AND allocation.status IN ('active','partially_reversed')
        AND receipt.status='posted'
    ),0) AS line_collected_minor,
    (
      SELECT settlement.settlement_number
      FROM canonical_compensation_settlement_allocations settlement_allocation
      JOIN canonical_compensation_settlements settlement
        ON settlement.tenant_id=settlement_allocation.tenant_id
       AND settlement.settlement_public_id=settlement_allocation.settlement_public_id
      WHERE settlement_allocation.tenant_id=a.tenant_id
        AND settlement_allocation.accrual_public_id=a.accrual_public_id
        AND settlement_allocation.remaining_minor > 0
        AND settlement_allocation.status IN ('active','partially_reversed')
        AND settlement.status IN ('posted','partially_reversed')
      ORDER BY settlement.settled_at_utc DESC, settlement.id DESC
      LIMIT 1
    ) AS settlement_number
  FROM canonical_compensation_accruals a
  JOIN canonical_invoices invoice
    ON invoice.tenant_id=a.tenant_id
   AND invoice.invoice_public_id=a.invoice_public_id
  LEFT JOIN canonical_practitioners practitioner
    ON practitioner.tenant_id=a.tenant_id
   AND practitioner.practitioner_public_id=a.practitioner_public_id
  LEFT JOIN canonical_compensation_reporting_context ctx
    ON ctx.tenant_id=a.tenant_id
   AND ctx.accrual_public_id=a.accrual_public_id
  LEFT JOIN canonical_compensation_refund_reservations refund_reservation
    ON refund_reservation.tenant_id=a.tenant_id
   AND refund_reservation.accrual_public_id=a.accrual_public_id
   AND refund_reservation.status <> 'released'
   AND refund_reservation.id=(
     SELECT candidate.id
     FROM canonical_compensation_refund_reservations candidate
     WHERE candidate.tenant_id=a.tenant_id
       AND candidate.accrual_public_id=a.accrual_public_id
       AND candidate.status <> 'released'
     ORDER BY candidate.id DESC
     LIMIT 1
   )
  WHERE a.tenant_id=?
    AND a.business_date >= date(?)
    AND a.business_date <= date(?)
    AND a.status <> 'reversed'
  ORDER BY a.accrued_at_utc DESC, a.id DESC
`;

function safeInteger(value: unknown, label: string): number {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`Invalid canonical doctor analytics ${label}`);
  }
  return number;
}

function positiveIntegerOrNull(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function major(minor: number): number {
  return Math.round(minor) / 100;
}

function normalizePage(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive integer`);
  return value;
}

function isReserve(fact: CanonicalDoctorFact): boolean {
  return fact.accrualStage === 'performer_reserve' || fact.sourceKind === 'performer_reserve';
}

function isVisit(fact: CanonicalDoctorFact): boolean {
  return fact.sourceKind === 'consultation_fee';
}

function isTestSource(fact: CanonicalDoctorFact): boolean {
  return fact.sourceKind === 'lab_test' || fact.sourceKind === 'referral' || isReserve(fact);
}

function isDirectPerformerTest(fact: CanonicalDoctorFact): boolean {
  return !isReserve(fact)
    && fact.sourceKind === 'lab_test'
    && (fact.incentiveType === 'performer' || fact.practitionerRole === 'performing');
}

function isReferredTest(fact: CanonicalDoctorFact): boolean {
  return !isReserve(fact)
    && isTestSource(fact)
    && !isDirectPerformerTest(fact);
}

function factKey(fact: CanonicalDoctorFact): string {
  return `${fact.invoicePublicId}:${fact.invoiceLinePublicId}`;
}

function mapFact(row: CanonicalDoctorFactRow): CanonicalDoctorFact {
  if (!row.source_kind?.trim()) {
    throw new Error(`Canonical compensation reporting context missing for ${row.accrual_public_id}`);
  }
  if (row.currency_code !== 'BDT') {
    throw new Error(`Unsupported canonical doctor analytics currency ${row.currency_code}`);
  }
  const practitionerPublicId = row.practitioner_public_id ?? null;
  const doctorId = positiveIntegerOrNull(row.doctor_id);
  if (practitionerPublicId && doctorId == null) {
    throw new Error(`Canonical practitioner mapping missing for ${practitionerPublicId}`);
  }
  const canonicalEarnedMinor = safeInteger(row.earned_minor, 'earned amount');
  const adjustedMinor = safeInteger(row.adjusted_minor, 'adjusted amount');
  const originalDoctorWaiverMinor = safeInteger(row.doctor_waiver_minor, 'doctor waiver amount');
  if (originalDoctorWaiverMinor > adjustedMinor || originalDoctorWaiverMinor > canonicalEarnedMinor) {
    throw new Error(`Canonical doctor waiver exceeds canonical adjustment authority for ${row.accrual_public_id}`);
  }
  const settledMinor = safeInteger(row.settled_minor, 'settled amount');
  const canonicalPayableMinor = safeInteger(row.payable_minor, 'payable amount');
  if (canonicalEarnedMinor - adjustedMinor - settledMinor !== canonicalPayableMinor) {
    throw new Error(`Canonical compensation payable invariant failed for ${row.accrual_public_id}`);
  }
  const payableBeforeSettlementMinor = canonicalPayableMinor + settledMinor;
  const refundReservedEarnedMinor = row.refund_reserved_earned_minor == null
    ? null
    : safeInteger(row.refund_reserved_earned_minor, 'refund reserved earned amount');
  const refundReservedWaiverMinor = row.refund_reserved_waiver_minor == null
    ? null
    : safeInteger(row.refund_reserved_waiver_minor, 'refund reserved waiver amount');
  const refundReservedPayableMinor = row.refund_reserved_payable_minor == null
    ? null
    : safeInteger(row.refund_reserved_payable_minor, 'refund reserved payable amount');
  const earnedMinor = refundReservedEarnedMinor ?? canonicalEarnedMinor;
  const doctorWaiverMinor = refundReservedWaiverMinor ?? originalDoctorWaiverMinor;
  if (refundReservedPayableMinor != null) {
    if (earnedMinor - doctorWaiverMinor !== refundReservedPayableMinor) {
      throw new Error(`Canonical refund compensation display invariant failed for ${row.accrual_public_id}`);
    }
    if (refundReservedPayableMinor !== payableBeforeSettlementMinor) {
      throw new Error(`Canonical refund compensation payable differs from accrual authority for ${row.accrual_public_id}`);
    }
  }
  const paidMinor = settledMinor;
  const outstandingMinor = canonicalPayableMinor;
  return {
    id: safeInteger(row.id, 'accrual id'),
    accrualPublicId: row.accrual_public_id,
    invoicePublicId: row.invoice_public_id,
    invoiceLinePublicId: row.invoice_line_public_id,
    practitionerPublicId,
    practitionerRole: row.practitioner_role,
    accrualStage: row.accrual_stage,
    rulePublicId: row.rule_public_id,
    ruleVersion: safeInteger(row.rule_version, 'rule version'),
    rateType: row.rate_type,
    rateValue: safeInteger(row.rate_value, 'rate value'),
    grossMinor: safeInteger(row.gross_minor, 'gross amount'),
    discountMinor: safeInteger(row.discount_minor, 'discount amount'),
    performerReserveMinor: safeInteger(row.performer_reserve_minor, 'performer reserve amount'),
    eligibleBaseMinor: row.refund_reserved_base_minor == null
      ? safeInteger(row.eligible_base_minor, 'eligible base amount')
      : safeInteger(row.refund_reserved_base_minor, 'refund reserved base amount'),
    earnedMinor,
    adjustedMinor,
    doctorWaiverMinor,
    settledMinor,
    canonicalPayableMinor,
    payableBeforeSettlementMinor,
    paidMinor,
    outstandingMinor,
    status: row.status,
    accruedAtUtc: row.accrued_at_utc,
    businessDate: row.business_date,
    sourceKind: row.source_kind,
    incentiveType: row.incentive_type ?? null,
    legacyBillId: positiveIntegerOrNull(row.legacy_bill_id),
    legacyInvoiceItemId: positiveIntegerOrNull(row.legacy_invoice_item_id),
    legacyLabOrderItemId: positiveIntegerOrNull(row.legacy_lab_order_item_id),
    detailName: row.detail_name?.trim() || null,
    sourceReference: row.source_reference?.trim() || null,
    waiverReason: row.waiver_reason?.trim() || null,
    doctorId,
    doctorName: row.doctor_name?.trim() || 'Unassigned Doctor',
    invoiceNumber: row.invoice_number?.trim() || null,
    legacyPatientId: positiveIntegerOrNull(row.legacy_patient_id),
    invoiceStatus: row.invoice_status ?? null,
    lineCollectedMinor: safeInteger(row.line_collected_minor, 'line collection amount'),
    settlementNumber: row.settlement_number?.trim() || null,
  };
}

async function loadFacts(
  db: CanonicalExecutiveDoctorAnalyticsDatabase,
  tenantId: string,
  period: ExecutiveDashboardPeriod,
): Promise<CanonicalDoctorFact[]> {
  const { results = [] } = await db.prepare(FACT_SQL)
    .bind(tenantId, period.startDate, period.endDate)
    .all<CanonicalDoctorFactRow>();
  const facts = results.map(mapFact);
  const reserveLineKeys = new Set(facts.filter(isReserve).map(factKey));
  return facts.filter((fact) => !(isDirectPerformerTest(fact) && reserveLineKeys.has(factKey(fact))));
}

function emptyPerformanceRow(doctorId: number | null, doctorName: string): DoctorPerformanceRow {
  return {
    doctorId,
    doctorName,
    visits: 0,
    visitCollection: 0,
    visitCommission: 0,
    tests: 0,
    referredTests: 0,
    discountedTests: 0,
    testGrossAmount: 0,
    testDiscountAmount: 0,
    testCollection: 0,
    referrerCommission: 0,
    performerReserveCount: 0,
    performedTests: 0,
    performerReserve: 0,
    testCommission: 0,
    otherCommission: 0,
    earnedCommission: 0,
    doctorWaiver: 0,
    payableCommission: 0,
    paidCommission: 0,
    outstandingCommission: 0,
    totalCommission: 0,
  };
}

function doctorKey(fact: CanonicalDoctorFact): string {
  return fact.doctorId == null ? 'unassigned' : String(fact.doctorId);
}

function aggregateFacts(facts: CanonicalDoctorFact[]): DoctorPerformanceRow[] {
  const accumulators = new Map<string, RowAccumulator>();
  for (const fact of facts) {
    const key = doctorKey(fact);
    const accumulator = accumulators.get(key) ?? {
      row: emptyPerformanceRow(fact.doctorId, fact.doctorName),
      referredLines: new Map<string, CanonicalDoctorFact>(),
      performedLines: new Map<string, CanonicalDoctorFact>(),
      visitLines: new Map<string, CanonicalDoctorFact>(),
    };
    const row = accumulator.row;
    row.earnedCommission += major(fact.earnedMinor);
    row.doctorWaiver += major(fact.doctorWaiverMinor);
    row.payableCommission += major(fact.payableBeforeSettlementMinor);
    row.paidCommission += major(fact.paidMinor);
    row.outstandingCommission += major(fact.outstandingMinor);

    if (isVisit(fact)) {
      accumulator.visitLines.set(factKey(fact), fact);
      row.visitCommission += major(fact.payableBeforeSettlementMinor);
    } else if (isReferredTest(fact)) {
      accumulator.referredLines.set(factKey(fact), fact);
      row.referrerCommission += major(fact.payableBeforeSettlementMinor);
    } else if (isReserve(fact) || isDirectPerformerTest(fact)) {
      accumulator.performedLines.set(factKey(fact), fact);
      row.performerReserve += major(fact.payableBeforeSettlementMinor);
    } else {
      row.otherCommission += major(fact.payableBeforeSettlementMinor);
    }
    accumulators.set(key, accumulator);
  }

  const rows: DoctorPerformanceRow[] = [];
  for (const accumulator of accumulators.values()) {
    const { row, referredLines, performedLines, visitLines } = accumulator;
    row.visits = visitLines.size;
    row.visitCollection = Array.from(visitLines.values()).reduce(
      (sum, fact) => sum + major(Math.min(Math.max(0, fact.grossMinor - fact.discountMinor), fact.lineCollectedMinor)),
      0,
    );
    row.referredTests = referredLines.size;
    row.tests = row.referredTests;
    row.discountedTests = Array.from(referredLines.values()).filter((fact) => fact.discountMinor > 0).length;
    row.testGrossAmount = Array.from(referredLines.values()).reduce((sum, fact) => sum + major(fact.grossMinor), 0);
    row.testDiscountAmount = Array.from(referredLines.values()).reduce((sum, fact) => sum + major(fact.discountMinor), 0);
    row.testCollection = Array.from(referredLines.values()).reduce(
      (sum, fact) => sum + major(Math.min(Math.max(0, fact.grossMinor - fact.discountMinor), fact.lineCollectedMinor)),
      0,
    );
    row.performedTests = performedLines.size;
    row.performerReserveCount = row.performedTests;
    row.testCommission = row.referrerCommission + row.performerReserve;
    row.totalCommission = row.payableCommission;
    for (const key of Object.keys(row) as Array<keyof DoctorPerformanceRow>) {
      if (typeof row[key] === 'number') (row[key] as number) = Math.round((row[key] as number) * 100) / 100;
    }
    rows.push(row);
  }
  return rows;
}

const SORT_FIELDS: Record<DoctorPerformanceSort, keyof DoctorPerformanceRow> = {
  visits: 'visits',
  tests: 'tests',
  visitCollection: 'visitCollection',
  testCollection: 'testCollection',
  testDiscount: 'testDiscountAmount',
  earnedCommission: 'earnedCommission',
  payableCommission: 'payableCommission',
  outstandingCommission: 'outstandingCommission',
  totalCommission: 'payableCommission',
};

function sortRows(
  rows: DoctorPerformanceRow[],
  sortBy: DoctorPerformanceSort,
  direction: DoctorPerformanceSortDirection,
): DoctorPerformanceRow[] {
  const field = SORT_FIELDS[sortBy];
  const multiplier = direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const difference = Number(left[field] ?? 0) - Number(right[field] ?? 0);
    if (difference !== 0) return difference * multiplier;
    return left.doctorName.localeCompare(right.doctorName);
  });
}

function totals(rows: DoctorPerformanceRow[]): Omit<DoctorPerformanceRow, 'doctorId' | 'doctorName'> {
  const total = emptyPerformanceRow(null, 'Total');
  for (const row of rows) {
    for (const key of Object.keys(total) as Array<keyof DoctorPerformanceRow>) {
      if (key === 'doctorId' || key === 'doctorName') continue;
      if (typeof total[key] === 'number') (total[key] as number) += Number(row[key] ?? 0);
    }
  }
  const { doctorId: _doctorId, doctorName: _doctorName, ...result } = total;
  return result;
}

function detailsSummary(row: DoctorPerformanceRow | undefined): DoctorPerformanceDetailsSummary {
  const source = row ?? emptyPerformanceRow(null, 'Unassigned Doctor');
  return {
    visits: source.visits,
    visitCollection: source.visitCollection,
    referredTests: source.referredTests,
    discountedTests: source.discountedTests,
    testGrossAmount: source.testGrossAmount,
    testDiscountAmount: source.testDiscountAmount,
    testCollection: source.testCollection,
    performedTests: source.performedTests,
    performerReserveAmount: source.performerReserve,
    earnedCommission: source.earnedCommission,
    doctorWaiver: source.doctorWaiver,
    payableCommission: source.payableCommission,
    paidCommission: source.paidCommission,
    outstandingCommission: source.outstandingCommission,
  };
}

function rateLabel(fact: CanonicalDoctorFact): string | null {
  if (fact.rateType === 'basis_points') return `${(fact.rateValue / 100).toFixed(2)}%`;
  if (fact.rateType === 'fixed') return `Flat BDT ${(fact.rateValue / 100).toFixed(2)}`;
  return null;
}

function commissionRows(facts: CanonicalDoctorFact[]): DoctorCommissionDetailRow[] {
  return facts.map((fact) => {
    const adjustmentAmount = fact.adjustedMinor === fact.doctorWaiverMinor
      ? 0
      : major(-(fact.adjustedMinor - fact.doctorWaiverMinor));
    const reasonCode = resolveCommissionReasonCode({
      ruleId: fact.rulePublicId,
      status: fact.status,
      eligibleBaseAmount: major(fact.eligibleBaseMinor),
      waiverAmount: major(fact.doctorWaiverMinor),
      adjustmentAmount,
      payableAmount: major(fact.payableBeforeSettlementMinor),
    });
    return {
      id: fact.id,
      occurredAt: fact.accruedAtUtc,
      sourceType: fact.sourceKind,
      incentiveType: fact.incentiveType,
      doctorName: fact.doctorName,
      detailName: fact.detailName,
      referenceNo: fact.sourceReference ?? fact.invoiceNumber,
      billId: fact.legacyBillId,
      commissionRuleId: fact.rulePublicId,
      commissionRuleVersion: fact.ruleVersion,
      adjustmentAmount,
      reasonCode,
      reasonLabel: commissionReasonLabel(reasonCode),
      grossAmount: major(fact.grossMinor),
      discountAmount: major(fact.discountMinor),
      netBilledAmount: major(Math.max(0, fact.grossMinor - fact.discountMinor)),
      performerReserveAmount: major(isReserve(fact) ? fact.earnedMinor : fact.performerReserveMinor),
      commissionBaseAmount: major(fact.eligibleBaseMinor),
      rateLabel: rateLabel(fact),
      earnedAmount: major(fact.earnedMinor),
      waiverAmount: major(fact.doctorWaiverMinor),
      payableAmount: major(fact.payableBeforeSettlementMinor),
      paidAmount: major(fact.paidMinor),
      outstandingAmount: major(fact.outstandingMinor),
      settlementNo: fact.settlementNumber,
      waiverReason: fact.waiverReason,
      amount: major(fact.payableBeforeSettlementMinor),
      status: fact.status,
    };
  });
}

function groupTestFacts(
  facts: CanonicalDoctorFact[],
  selection?: { doctorId: number | null; attribution: 'referring' | 'performing' },
): DoctorTestDetailRow[] {
  const grouped = new Map<string, CanonicalDoctorFact[]>();
  for (const fact of facts.filter(isTestSource)) {
    const key = factKey(fact);
    grouped.set(key, [...(grouped.get(key) ?? []), fact]);
  }
  const groups = Array.from(grouped.values()).filter((entries) => {
    if (!selection) return true;
    if (selection.attribution === 'performing') {
      return entries.some((fact) => (isReserve(fact) || isDirectPerformerTest(fact))
        && fact.doctorId === selection.doctorId);
    }
    return entries.some((fact) => isReferredTest(fact) && fact.doctorId === selection.doctorId);
  });
  return groups.map((entries) => {
    const referral = entries.find(isReferredTest);
    const performer = entries.find(isReserve) ?? entries.find(isDirectPerformerTest);
    const financialEntries = selection
      ? entries.filter((fact) => {
        const matchesRole = selection.attribution === 'performing'
          ? isReserve(fact) || isDirectPerformerTest(fact)
          : isReferredTest(fact);
        return matchesRole && fact.doctorId === selection.doctorId;
      })
      : entries;
    const primary = financialEntries[0] ?? referral ?? performer ?? entries[0];
    const grossMinor = Math.max(...financialEntries.map((fact) => fact.grossMinor));
    const discountMinor = Math.max(...financialEntries.map((fact) => fact.discountMinor));
    const netMinor = Math.max(0, grossMinor - discountMinor);
    const payableMinor = financialEntries.reduce((sum, fact) => sum + fact.payableBeforeSettlementMinor, 0);
    const paidMinor = financialEntries.reduce((sum, fact) => sum + fact.paidMinor, 0);
    const waiverMinor = financialEntries.reduce((sum, fact) => sum + fact.doctorWaiverMinor, 0);
    const earnedMinor = financialEntries.reduce((sum, fact) => sum + fact.earnedMinor, 0);
    const outstandingMinor = financialEntries.reduce((sum, fact) => sum + fact.outstandingMinor, 0);
    const reserveMinor = financialEntries.reduce(
      (sum, fact) => sum + (isReserve(fact) ? fact.earnedMinor : fact.performerReserveMinor),
      0,
    );
    const baseMinor = Math.max(...financialEntries.map((fact) => fact.eligibleBaseMinor));
    return {
      id: primary.legacyLabOrderItemId ?? primary.legacyInvoiceItemId ?? primary.id,
      occurredAt: primary.accruedAtUtc,
      testName: primary.detailName ?? 'Diagnostic Service',
      patientName: null,
      referringDoctorName: referral?.doctorName ?? 'Unassigned Doctor',
      orderingDoctorName: 'Unassigned Ordering Doctor',
      orderingClinicianId: null,
      orderingClinicianName: null,
      enteredByUserId: null,
      enteredByName: null,
      performingDoctorId: performer?.doctorId ?? null,
      performingDoctorName: performer?.doctorName ?? null,
      invoiceNo: primary.invoiceNumber,
      accessionNo: null,
      status: primary.invoiceStatus,
      grossAmount: major(grossMinor),
      discountAmount: major(discountMinor),
      netBilledAmount: major(netMinor),
      billedAmount: major(netMinor),
      collectedAmount: major(Math.min(netMinor, primary.lineCollectedMinor)),
      dueAmount: major(Math.max(0, netMinor - primary.lineCollectedMinor)),
      performerReserveAmount: major(reserveMinor),
      commissionBaseAmount: major(baseMinor),
      earnedAmount: major(earnedMinor),
      waiverAmount: major(waiverMinor),
      payableAmount: major(payableMinor),
      paidAmount: major(paidMinor),
      outstandingAmount: major(outstandingMinor),
      testCommission: major(earnedMinor),
    };
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id - left.id);
}

function visitRows(facts: CanonicalDoctorFact[]): DoctorVisitDetailRow[] {
  const grouped = new Map<string, CanonicalDoctorFact>();
  for (const fact of facts.filter(isVisit)) grouped.set(factKey(fact), fact);
  return Array.from(grouped.values()).map((fact) => {
    const netMinor = Math.max(0, fact.grossMinor - fact.discountMinor);
    const collectedMinor = Math.min(netMinor, fact.lineCollectedMinor);
    return {
      id: fact.accrualPublicId,
      occurredAt: fact.accruedAtUtc,
      patientName: null,
      invoiceNo: fact.invoiceNumber,
      serviceName: fact.detailName ?? 'Consultation',
      billedAmount: major(netMinor),
      collectedAmount: major(collectedMinor),
      dueAmount: major(Math.max(0, netMinor - collectedMinor)),
      status: fact.invoiceStatus,
    };
  }).sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id));
}

function paginate<T>(rows: T[], page: number, pageSize: number): {
  rows: T[];
  totalRows: number;
  hasNextPage: boolean;
} {
  const offset = (page - 1) * pageSize;
  return {
    rows: rows.slice(offset, offset + pageSize),
    totalRows: rows.length,
    hasNextPage: offset + pageSize < rows.length,
  };
}

export async function getCanonicalExecutiveDoctorPerformance(args: {
  dbBinding: CanonicalExecutiveDoctorAnalyticsDatabase;
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  search: string;
  sortBy: DoctorPerformanceSort;
  sortDirection: DoctorPerformanceSortDirection;
  page: number;
  pageSize: number;
}): Promise<DoctorPerformanceResponse> {
  const page = normalizePage(args.page, 'page');
  const pageSize = normalizePage(args.pageSize, 'pageSize');
  const facts = await loadFacts(args.dbBinding, args.tenantId, args.period);
  const allRows = aggregateFacts(facts);
  const search = args.search.trim().toLocaleLowerCase('en-US');
  const filteredRows = search
    ? allRows.filter((row) => row.doctorName.toLocaleLowerCase('en-US').includes(search))
    : allRows;
  const sortedRows = sortRows(filteredRows, args.sortBy, args.sortDirection);
  const pageResult = paginate(sortedRows, page, pageSize);
  return {
    period: args.period,
    queryContract: CANONICAL_QUERY_CONTRACT,
    totals: totals(filteredRows),
    rows: pageResult.rows,
    page,
    pageSize,
    totalRows: pageResult.totalRows,
    hasNextPage: pageResult.hasNextPage,
  };
}

export async function getCanonicalExecutiveDoctorPerformanceDetails(args: {
  dbBinding: CanonicalExecutiveDoctorAnalyticsDatabase;
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number | null;
  tab: DoctorPerformanceDetailsTab;
  page: number;
  pageSize: number;
}): Promise<DoctorPerformanceDetailsResponse> {
  const page = normalizePage(args.page, 'page');
  const pageSize = normalizePage(args.pageSize, 'pageSize');
  const allFacts = await loadFacts(args.dbBinding, args.tenantId, args.period);
  const facts = allFacts.filter((fact) => fact.doctorId === args.doctorId);
  const performance = aggregateFacts(facts)[0];
  const isReferredTab = args.tab === 'tests' || args.tab === 'referred-tests';
  const allRows: Array<DoctorVisitDetailRow | DoctorTestDetailRow | DoctorCommissionDetailRow> =
    args.tab === 'commissions'
      ? commissionRows(facts)
      : isReferredTab
        ? groupTestFacts(allFacts, { doctorId: args.doctorId, attribution: 'referring' })
        : args.tab === 'performed-tests'
          ? groupTestFacts(allFacts, { doctorId: args.doctorId, attribution: 'performing' })
          : visitRows(facts);
  const pageResult = paginate<DoctorVisitDetailRow | DoctorTestDetailRow | DoctorCommissionDetailRow>(
    allRows,
    page,
    pageSize,
  );
  return {
    period: args.period,
    queryContract: CANONICAL_QUERY_CONTRACT,
    doctorId: args.doctorId,
    tab: args.tab,
    summary: detailsSummary(performance),
    rows: pageResult.rows,
    page,
    pageSize,
    totalRows: pageResult.totalRows,
    hasNextPage: pageResult.hasNextPage,
  };
}
