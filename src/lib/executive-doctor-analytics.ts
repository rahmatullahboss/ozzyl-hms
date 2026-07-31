import { getDb } from '../db';
import type { Env } from '../types';
import {
  getCanonicalExecutiveDoctorPerformance,
  getCanonicalExecutiveDoctorPerformanceDetails,
  type CanonicalExecutiveDoctorAnalyticsDatabase,
} from './canonical/reporting/executive-doctor-analytics';
import {
  resolveDoctorAnalyticsProviderMode,
  type DoctorAnalyticsProviderDatabase,
} from './doctor-analytics-provider';
import type { ExecutiveDashboardPeriod } from './executive-dashboard-period';
import {
  commissionReasonLabel,
  resolveCommissionReasonCode,
  type CommissionReasonCode,
} from '../services/dashboard/doctorReportingContract';

export type DoctorPerformanceSort =
  | 'visits'
  | 'tests'
  | 'visitCollection'
  | 'testCollection'
  | 'testDiscount'
  | 'earnedCommission'
  | 'payableCommission'
  | 'outstandingCommission'
  | 'totalCommission';

export type DoctorPerformanceSortDirection = 'asc' | 'desc';
export type DoctorPerformanceDetailsTab =
  | 'visits'
  | 'tests'
  | 'referred-tests'
  | 'performed-tests'
  | 'commissions';

export interface DoctorAnalyticsQueryContract {
  contractVersion: 'doctor-compensation-v1';
  dataSource: 'legacy' | 'canonical';
  moneyUnit: 'major';
  currencyCode: 'BDT';
  dateBasis: 'tenant-business-date-asia-dhaka';
  cutoverPolicy: 'explicit-provider-switch';
}

const LEGACY_DOCTOR_ANALYTICS_QUERY_CONTRACT: DoctorAnalyticsQueryContract = {
  contractVersion: 'doctor-compensation-v1',
  dataSource: 'legacy',
  moneyUnit: 'major',
  currencyCode: 'BDT',
  dateBasis: 'tenant-business-date-asia-dhaka',
  cutoverPolicy: 'explicit-provider-switch',
};

export interface DoctorPerformanceRow {
  doctorId: number | null;
  doctorName: string;
  visits: number;
  visitCollection: number;
  visitCommission: number;
  tests: number;
  referredTests: number;
  discountedTests: number;
  testGrossAmount: number;
  testDiscountAmount: number;
  testCollection: number;
  referrerCommission: number;
  performerReserveCount: number;
  performedTests: number;
  performerReserve: number;
  testCommission: number;
  otherCommission: number;
  earnedCommission: number;
  doctorWaiver: number;
  payableCommission: number;
  paidCommission: number;
  outstandingCommission: number;
  totalCommission: number;
}

export interface DoctorPerformanceResponse {
  period: ExecutiveDashboardPeriod;
  queryContract: DoctorAnalyticsQueryContract;
  totals: Omit<DoctorPerformanceRow, 'doctorId' | 'doctorName'>;
  rows: DoctorPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export type DoctorVisitDetailRow = {
  id: string;
  occurredAt: string;
  patientName: string | null;
  invoiceNo: string | null;
  serviceName: string;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  status: string | null;
};

export type DoctorTestDetailRow = {
  id: number;
  occurredAt: string;
  testName: string;
  patientName: string | null;
  referringDoctorName: string;
  orderingDoctorName: string;
  orderingClinicianId: number | null;
  orderingClinicianName: string | null;
  enteredByUserId: number | null;
  enteredByName: string | null;
  performingDoctorId: number | null;
  performingDoctorName: string | null;
  invoiceNo: string | null;
  accessionNo: string | null;
  status: string | null;
  grossAmount: number;
  discountAmount: number;
  netBilledAmount: number;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  earnedAmount: number;
  waiverAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  testCommission: number;
};

export type DoctorCommissionDetailRow = {
  id: number;
  occurredAt: string;
  sourceType: string;
  incentiveType: string | null;
  doctorName: string;
  detailName: string | null;
  referenceNo: string | null;
  billId: number | null;
  commissionRuleId: number | string | null;
  commissionRuleVersion: number | null;
  adjustmentAmount: number;
  reasonCode: CommissionReasonCode;
  reasonLabel: string;
  grossAmount: number;
  discountAmount: number;
  netBilledAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  rateLabel: string | null;
  earnedAmount: number;
  waiverAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  settlementNo: string | null;
  waiverReason: string | null;
  amount: number;
  status: string | null;
};

export interface DoctorPerformanceDetailsSummary {
  visits: number;
  visitCollection: number;
  referredTests: number;
  discountedTests: number;
  testGrossAmount: number;
  testDiscountAmount: number;
  testCollection: number;
  performedTests: number;
  performerReserveAmount: number;
  earnedCommission: number;
  doctorWaiver: number;
  payableCommission: number;
  paidCommission: number;
  outstandingCommission: number;
}

export interface DoctorPerformanceDetailsResponse {
  period: ExecutiveDashboardPeriod;
  queryContract: DoctorAnalyticsQueryContract;
  doctorId: number | null;
  tab: DoctorPerformanceDetailsTab;
  summary: DoctorPerformanceDetailsSummary;
  rows: Array<DoctorVisitDetailRow | DoctorTestDetailRow | DoctorCommissionDetailRow>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

type DoctorPerformanceDbRow = {
  doctor_id?: number | string | null;
  doctor_name?: string | null;
  visits?: number | string | null;
  visit_collection?: number | string | null;
  visit_commission?: number | string | null;
  tests?: number | string | null;
  referred_tests?: number | string | null;
  discounted_tests?: number | string | null;
  test_gross_amount?: number | string | null;
  test_discount_amount?: number | string | null;
  test_collection?: number | string | null;
  referrer_commission?: number | string | null;
  performer_reserve_count?: number | string | null;
  performed_tests?: number | string | null;
  performer_reserve?: number | string | null;
  test_commission?: number | string | null;
  other_commission?: number | string | null;
  earned_commission?: number | string | null;
  doctor_waiver?: number | string | null;
  payable_commission?: number | string | null;
  paid_commission?: number | string | null;
  outstanding_commission?: number | string | null;
  total_commission?: number | string | null;
  total_rows?: number | string | null;
  overall_visits?: number | string | null;
  overall_visit_collection?: number | string | null;
  overall_visit_commission?: number | string | null;
  overall_tests?: number | string | null;
  overall_referred_tests?: number | string | null;
  overall_discounted_tests?: number | string | null;
  overall_test_gross_amount?: number | string | null;
  overall_test_discount_amount?: number | string | null;
  overall_test_collection?: number | string | null;
  overall_referrer_commission?: number | string | null;
  overall_performer_reserve_count?: number | string | null;
  overall_performed_tests?: number | string | null;
  overall_performer_reserve?: number | string | null;
  overall_test_commission?: number | string | null;
  overall_other_commission?: number | string | null;
  overall_earned_commission?: number | string | null;
  overall_doctor_waiver?: number | string | null;
  overall_payable_commission?: number | string | null;
  overall_paid_commission?: number | string | null;
  overall_outstanding_commission?: number | string | null;
  overall_total_commission?: number | string | null;
};

type DoctorDetailDbRow = {
  id?: number | string | null;
  occurred_at?: string | null;
  patient_name?: string | null;
  invoice_no?: string | null;
  service_name?: string | null;
  billed_amount?: number | string | null;
  collected_amount?: number | string | null;
  due_amount?: number | string | null;
  status?: string | null;
  test_name?: string | null;
  referring_doctor_name?: string | null;
  ordering_doctor_name?: string | null;
  ordering_clinician_id?: number | string | null;
  ordering_clinician_name?: string | null;
  entered_by_user_id?: number | string | null;
  entered_by_name?: string | null;
  performing_doctor_id?: number | string | null;
  performing_doctor_name?: string | null;
  accession_no?: string | null;
  test_commission?: number | string | null;
  gross_amount?: number | string | null;
  discount_amount?: number | string | null;
  net_billed_amount?: number | string | null;
  performer_reserve_amount?: number | string | null;
  commission_base_amount?: number | string | null;
  earned_amount?: number | string | null;
  waiver_amount?: number | string | null;
  payable_amount?: number | string | null;
  paid_amount?: number | string | null;
  outstanding_amount?: number | string | null;
  rate_label?: string | null;
  settlement_no?: string | null;
  waiver_reason?: string | null;
  source_type?: string | null;
  incentive_type?: string | null;
  doctor_name?: string | null;
  detail_name?: string | null;
  reference_no?: string | null;
  bill_id?: number | string | null;
  commission_rule_id?: number | string | null;
  commission_rule_version?: number | string | null;
  adjustment_amount?: number | string | null;
  reason_code?: string | null;
  reason_label?: string | null;
  amount?: number | string | null;
  total_rows?: number | string | null;
};

const SORT_COLUMNS: Record<DoctorPerformanceSort, string> = {
  visits: 'visits',
  tests: 'referred_tests',
  visitCollection: 'visit_collection',
  testCollection: 'test_collection',
  testDiscount: 'test_discount_amount',
  earnedCommission: 'earned_commission',
  payableCommission: 'payable_commission',
  outstandingCommission: 'outstanding_commission',
  totalCommission: 'payable_commission',
};

function roundMoney(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function wholeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function nullableId(value: unknown): number | null {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nullableRuleId(value: unknown): number | string | null {
  if (typeof value === 'number') return Number.isInteger(value) && value > 0 ? value : null;
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === normalized ? parsed : normalized;
}

function localDateSql(expression: string): string {
  const value = expression.includes(',') ? `COALESCE(${expression})` : expression;
  return `CASE
    WHEN ${value} IS NULL THEN NULL
    WHEN ${value} LIKE '%Z' OR ${value} LIKE '%+00:00' OR ${value} LIKE '%-00:00'
      THEN date(${value}, '+6 hours')
    ELSE date(${value})
  END`;
}

function consultationPredicate(alias: string): string {
  return `(
    LOWER(TRIM(COALESCE(${alias}.item_category, ''))) IN ('consultation', 'doctor_visit', 'opd', 'visit')
    OR LOWER(COALESCE(${alias}.description, '')) LIKE '%consult%'
    OR LOWER(COALESCE(${alias}.description, '')) LIKE '%doctor%'
  )`;
}

function fullyPaidBillSql(alias: string): string {
  return `(
    ${alias}.id IS NOT NULL
    AND COALESCE(${alias}.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    AND (
      COALESCE(${alias}.status, 'open') = 'paid'
      OR (
        COALESCE(${alias}.total, 0) > 0
        AND COALESCE(${alias}.paid, 0) >= COALESCE(${alias}.total, 0)
      )
    )
  )`;
}

function commissionAdjustmentAmountSql(alias: string): string {
  return `COALESCE(${alias}.reversed_amount, 0) + COALESCE(${alias}.clawback_amount, 0)`;
}

function reconciledCommissionAmountSql(alias: string): string {
  const adjustment = commissionAdjustmentAmountSql(alias);
  return `MAX(
    0,
    (CASE
      WHEN COALESCE(${alias}.doctor_waiver_amount, 0) != 0
        OR COALESCE(${alias}.payable_commission_amount, 0) != 0
        THEN COALESCE(${alias}.payable_commission_amount, 0)
      ELSE COALESCE(${alias}.commission_amount, 0)
    END) - ${adjustment}
  )`;
}

function earnedCommissionAmountSql(alias: string): string {
  const payable = reconciledCommissionAmountSql(alias);
  const adjustment = commissionAdjustmentAmountSql(alias);
  return `(CASE
    WHEN COALESCE(${alias}.doctor_waiver_amount, 0) != 0
      OR COALESCE(${alias}.payable_commission_amount, 0) != 0
      THEN MAX(
        0,
        MAX(
          COALESCE(${alias}.earned_commission_amount, 0),
          COALESCE(${alias}.payable_commission_amount, 0) + COALESCE(${alias}.doctor_waiver_amount, 0)
        ) - ${adjustment}
      )
    ELSE ${payable}
  END)`;
}

function paidCommissionAmountSql(alias: string): string {
  const payable = reconciledCommissionAmountSql(alias);
  return `MIN(${payable}, MAX(0, COALESCE(${alias}.paid_amount, 0)))`;
}

function outstandingCommissionAmountSql(alias: string): string {
  const payable = reconciledCommissionAmountSql(alias);
  const paid = paidCommissionAmountSql(alias);
  return `MAX(0, ${payable} - ${paid})`;
}

function linePaymentAllocationCtes(): string {
  return `
    bill_payment_totals AS (
      SELECT
        tenant_id,
        bill_id,
        COALESCE(SUM(amount), 0) AS gross_payment_amount
      FROM payments
      WHERE bill_id IS NOT NULL
      GROUP BY tenant_id, bill_id
    ),
    payment_base AS (
      SELECT
        p.id AS payment_id,
        p.bill_id,
        p.tenant_id,
        CASE
          WHEN COALESCE(bpt.gross_payment_amount, 0) <= 0
            THEN COALESCE(p.amount, 0)
          ELSE COALESCE(p.amount, 0)
            * MIN(
                COALESCE(bpt.gross_payment_amount, 0),
                MAX(0, COALESCE(b.paid, bpt.gross_payment_amount))
              )
            / bpt.gross_payment_amount
        END AS payment_amount
      FROM payments p
      JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      LEFT JOIN bill_payment_totals bpt ON bpt.bill_id = p.bill_id AND bpt.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND ${localDateSql('p.date, p.created_at')} >= date(?)
        AND ${localDateSql('p.date, p.created_at')} <= date(?)
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ),
    paid_bill_keys AS (
      SELECT DISTINCT tenant_id, bill_id
      FROM payment_base
    ),
    active_bill_lines AS (
      SELECT
        ii.id AS line_id,
        ii.bill_id,
        ii.tenant_id,
        ii.item_category,
        ii.reference_id,
        ii.description,
        CASE
          WHEN COALESCE(ii.line_total, 0) > 0 THEN COALESCE(ii.line_total, 0)
          ELSE MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1))
        END AS line_amount
      FROM invoice_items ii
      WHERE ii.tenant_id = ?
        AND COALESCE(ii.status, 'active') != 'cancelled'
    ),
    allocation_lines AS (
      SELECT
        abl.line_id,
        abl.bill_id,
        abl.tenant_id,
        abl.item_category,
        abl.reference_id,
        abl.description,
        abl.line_amount
      FROM active_bill_lines abl
      JOIN paid_bill_keys pbk ON pbk.tenant_id = abl.tenant_id AND pbk.bill_id = abl.bill_id

      UNION ALL

      SELECT
        -(b.id * 10 + 1) AS line_id,
        b.id AS bill_id,
        b.tenant_id,
        'doctor_visit' AS item_category,
        NULL AS reference_id,
        'Doctor visit' AS description,
        COALESCE(b.doctor_visit_bill, 0) AS line_amount
      FROM bills b
      JOIN paid_bill_keys pbk ON pbk.tenant_id = b.tenant_id AND pbk.bill_id = b.id
      WHERE COALESCE(b.doctor_visit_bill, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM active_bill_lines existing
          WHERE existing.tenant_id = b.tenant_id
            AND existing.bill_id = b.id
            AND ${consultationPredicate('existing')}
        )

      UNION ALL

      SELECT
        -(b.id * 10 + 2) AS line_id,
        b.id AS bill_id,
        b.tenant_id,
        'test' AS item_category,
        NULL AS reference_id,
        'Diagnostic tests' AS description,
        COALESCE(b.test_bill, 0) AS line_amount
      FROM bills b
      JOIN paid_bill_keys pbk ON pbk.tenant_id = b.tenant_id AND pbk.bill_id = b.id
      WHERE COALESCE(b.test_bill, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM active_bill_lines existing
          WHERE existing.tenant_id = b.tenant_id
            AND existing.bill_id = b.id
            AND LOWER(TRIM(COALESCE(existing.item_category, ''))) = 'test'
        )
    ),
    bill_line_totals AS (
      SELECT tenant_id, bill_id, SUM(line_amount) AS allocation_base
      FROM allocation_lines
      GROUP BY tenant_id, bill_id
    ),
    payment_allocations AS (
      SELECT
        pb.payment_id,
        pb.bill_id,
        pb.tenant_id,
        al.line_id,
        al.item_category,
        al.reference_id,
        al.description,
        CASE
          WHEN blt.allocation_base > 0
            THEN 1.0 * pb.payment_amount * al.line_amount / blt.allocation_base
          ELSE 0
        END AS allocated_amount
      FROM payment_base pb
      JOIN bill_line_totals blt ON blt.tenant_id = pb.tenant_id AND blt.bill_id = pb.bill_id
      JOIN allocation_lines al ON al.tenant_id = pb.tenant_id AND al.bill_id = pb.bill_id
    ),
    line_collections AS (
      SELECT tenant_id, bill_id, line_id, ROUND(SUM(allocated_amount), 2) AS collected_amount
      FROM payment_allocations
      GROUP BY tenant_id, bill_id, line_id
    )`;
}

function visitLinesCte(): string {
  return `
    visit_lines AS (
      SELECT
        ii.id AS line_id,
        ii.tenant_id,
        ii.bill_id,
        COALESCE(NULLIF(TRIM(ii.description), ''), 'Consultation') AS service_name,
        CASE
          WHEN COALESCE(ii.line_total, 0) > 0 THEN COALESCE(ii.line_total, 0)
          ELSE MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1))
        END AS billed_amount
      FROM invoice_items ii
      WHERE ii.tenant_id = ?
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND ${consultationPredicate('ii')}

      UNION ALL

      SELECT
        -(b.id * 10 + 1) AS line_id,
        b.tenant_id,
        b.id AS bill_id,
        'Doctor visit' AS service_name,
        COALESCE(b.doctor_visit_bill, 0) AS billed_amount
      FROM bills b
      WHERE b.tenant_id = ?
        AND COALESCE(b.doctor_visit_bill, 0) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM invoice_items existing
          WHERE existing.tenant_id = b.tenant_id
            AND existing.bill_id = b.id
            AND COALESCE(existing.status, 'active') != 'cancelled'
            AND ${consultationPredicate('existing')}
        )
    )`;
}

function doctorSummarySql(
  sortBy: DoctorPerformanceSort,
  sortDirection: DoctorPerformanceSortDirection,
  doctorId?: number | null,
): string {
  const sortColumn = SORT_COLUMNS[sortBy];
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  const filterSql = doctorId === undefined
    ? 'LOWER(doctor_name) LIKE LOWER(?)'
    : doctorId === null
      ? 'doctor_id IS NULL'
      : 'doctor_id = ?';
  return `/* executive_doctor:summary */
    WITH
    ${linePaymentAllocationCtes()},
    ${visitLinesCte()},
    bill_commission_doctors AS (
      SELECT
        dca.tenant_id,
        dca.bill_id,
        MAX(CASE WHEN dca.source_type = 'consultation_fee' THEN NULLIF(dca.doctor_id, 0) END) AS visit_commission_doctor_id,
        MAX(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN NULLIF(dca.doctor_id, 0)
        END) AS test_commission_doctor_id
      FROM doctor_commission_accruals dca
      WHERE dca.tenant_id = ?
        AND dca.bill_id IS NOT NULL
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
      GROUP BY dca.tenant_id, dca.bill_id
    ),
    visit_rows AS (
      SELECT
        b.id AS bill_id,
        COALESCE(
          NULLIF(bcd.visit_commission_doctor_id, 0),
          NULLIF(item_doctor.id, 0),
          NULLIF(v.doctor_id, 0),
          NULLIF(b.referring_doctor_id, 0)
        ) AS resolved_doctor_id
      FROM visit_lines vl
      JOIN bills b ON b.id = vl.bill_id AND b.tenant_id = vl.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN invoice_items source_line
        ON source_line.id = vl.line_id
        AND source_line.tenant_id = vl.tenant_id
        AND source_line.bill_id = vl.bill_id
      LEFT JOIN doctors item_doctor
        ON item_doctor.id = source_line.reference_id
        AND item_doctor.tenant_id = source_line.tenant_id
      LEFT JOIN bill_commission_doctors bcd
        ON bcd.tenant_id = b.tenant_id
        AND bcd.bill_id = b.id
      WHERE COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('b.created_at, v.visit_date, b.updated_at')} >= date(?)
        AND ${localDateSql('b.created_at, v.visit_date, b.updated_at')} <= date(?)
    ),
    visit_facts AS (
      SELECT
        resolved_doctor_id AS doctor_id,
        COUNT(DISTINCT bill_id) AS visits
      FROM visit_rows
      GROUP BY resolved_doctor_id
    ),
    referral_attribution AS (
      SELECT
        dca.lab_order_item_id,
        MAX(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN NULLIF(dca.doctor_id, 0)
        END) AS referring_doctor_id
      FROM doctor_commission_accruals dca
      WHERE dca.tenant_id = ?
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND dca.lab_order_item_id IS NOT NULL
      GROUP BY dca.lab_order_item_id
    ),
    test_fact_rows AS (
      SELECT
        'invoice-' || ii.id AS fact_key,
        COALESCE(
          NULLIF(b.referring_doctor_id, 0),
          NULLIF(bcd.test_commission_doctor_id, 0),
          NULLIF(ra.referring_doctor_id, 0),
          NULLIF(v.doctor_id, 0)
        ) AS doctor_id,
        MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)) AS gross_amount,
        MAX(
          0,
          COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1) - COALESCE(ii.line_total, 0)
        ) AS discount_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN lab_order_items loi
        ON loi.id = ii.reference_id
        AND loi.tenant_id = ii.tenant_id
        AND EXISTS (
          SELECT 1
          FROM lab_orders linked_order
          WHERE linked_order.id = loi.lab_order_id
            AND linked_order.tenant_id = loi.tenant_id
            AND linked_order.bill_id = b.id
        )
      LEFT JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
      LEFT JOIN bill_commission_doctors bcd ON bcd.tenant_id = b.tenant_id AND bcd.bill_id = b.id
      LEFT JOIN referral_attribution ra ON ra.lab_order_item_id = loi.id
      WHERE ii.tenant_id = ?
        AND LOWER(TRIM(COALESCE(ii.item_category, ''))) = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('lo.order_date, lo.created_at, b.created_at, b.updated_at')} >= date(?)
        AND ${localDateSql('lo.order_date, lo.created_at, b.created_at, b.updated_at')} <= date(?)

      UNION ALL

      SELECT
        'lab-' || loi.id AS fact_key,
        COALESCE(
          NULLIF(b.referring_doctor_id, 0),
          NULLIF(bcd.test_commission_doctor_id, 0),
          NULLIF(ra.referring_doctor_id, 0),
          NULLIF(v.doctor_id, 0)
        ) AS doctor_id,
        0.0 AS gross_amount,
        0.0 AS discount_amount
      FROM lab_order_items loi
      JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
      LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = loi.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN bill_commission_doctors bcd ON bcd.tenant_id = b.tenant_id AND bcd.bill_id = b.id
      LEFT JOIN referral_attribution ra ON ra.lab_order_item_id = loi.id
      WHERE loi.tenant_id = ?
        AND LOWER(TRIM(COALESCE(loi.status, loi.result_status, 'pending'))) != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('lo.order_date, lo.created_at')} >= date(?)
        AND ${localDateSql('lo.order_date, lo.created_at')} <= date(?)
        AND NOT EXISTS (
          SELECT 1
          FROM invoice_items linked_invoice
          WHERE linked_invoice.tenant_id = loi.tenant_id
            AND linked_invoice.bill_id = lo.bill_id
            AND LOWER(TRIM(COALESCE(linked_invoice.item_category, ''))) = 'test'
            AND linked_invoice.reference_id = loi.id
            AND COALESCE(linked_invoice.status, 'active') != 'cancelled'
        )
    ),
    test_facts AS (
      SELECT
        doctor_id,
        COUNT(DISTINCT fact_key) AS referred_tests,
        COUNT(DISTINCT CASE WHEN discount_amount > 0 THEN fact_key END) AS discounted_tests,
        ROUND(SUM(gross_amount), 2) AS test_gross_amount,
        ROUND(SUM(discount_amount), 2) AS test_discount_amount
      FROM test_fact_rows
      GROUP BY doctor_id
    ),
    service_collection_lines AS (
      SELECT
        COALESCE(
          NULLIF(bcd.visit_commission_doctor_id, 0),
          NULLIF(item_doctor.id, 0),
          NULLIF(v.doctor_id, 0),
          NULLIF(b.referring_doctor_id, 0)
        ) AS doctor_id,
        pa.bill_id,
        pa.allocated_amount AS visit_collection,
        0.0 AS test_collection
      FROM payment_allocations pa
      JOIN bills b ON b.id = pa.bill_id AND b.tenant_id = pa.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN bill_commission_doctors bcd ON bcd.tenant_id = b.tenant_id AND bcd.bill_id = b.id
      LEFT JOIN doctors item_doctor ON item_doctor.id = pa.reference_id AND item_doctor.tenant_id = pa.tenant_id
      WHERE ${consultationPredicate('pa')}

      UNION ALL

      SELECT
        COALESCE(
          NULLIF(b.referring_doctor_id, 0),
          NULLIF(bcd.test_commission_doctor_id, 0),
          NULLIF(ra.referring_doctor_id, 0),
          NULLIF(v.doctor_id, 0)
        ) AS doctor_id,
        pa.bill_id,
        0.0 AS visit_collection,
        pa.allocated_amount AS test_collection
      FROM payment_allocations pa
      JOIN bills b ON b.id = pa.bill_id AND b.tenant_id = pa.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN lab_order_items linked_loi
        ON linked_loi.id = pa.reference_id
        AND linked_loi.tenant_id = pa.tenant_id
      LEFT JOIN lab_orders linked_lo
        ON linked_lo.id = linked_loi.lab_order_id
        AND linked_lo.tenant_id = linked_loi.tenant_id
        AND linked_lo.bill_id = pa.bill_id
      LEFT JOIN bill_commission_doctors bcd ON bcd.tenant_id = b.tenant_id AND bcd.bill_id = b.id
      LEFT JOIN referral_attribution ra ON ra.lab_order_item_id = CASE WHEN linked_lo.id IS NOT NULL THEN linked_loi.id END
      WHERE LOWER(TRIM(COALESCE(pa.item_category, ''))) = 'test'
    ),
    collection_facts AS (
      SELECT
        doctor_id,
        ROUND(SUM(visit_collection), 2) AS visit_collection,
        ROUND(SUM(test_collection), 2) AS test_collection
      FROM service_collection_lines
      GROUP BY doctor_id
    ),
    performer_reserve_rows AS (
      SELECT
        r.bill_id,
        NULLIF(r.assigned_doctor_id, 0) AS doctor_id,
        ROUND(COALESCE(r.reserved_amount, 0), 2) AS reserved_amount,
        LOWER(COALESCE(r.status, 'reserved')) AS reserve_status
      FROM diagnostic_performer_reserves r
      JOIN bills reserve_bill
        ON reserve_bill.id = r.bill_id
        AND reserve_bill.tenant_id = r.tenant_id
      WHERE r.tenant_id = ?
        AND ${localDateSql('reserve_bill.created_at, r.reserved_at')} >= date(?)
        AND ${localDateSql('reserve_bill.created_at, r.reserved_at')} <= date(?)
        AND LOWER(COALESCE(r.status, 'reserved')) NOT IN ('cancelled', 'reversed')
        AND COALESCE(r.reserved_amount, 0) > 0
        AND COALESCE(reserve_bill.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    ),
    performer_reserve_facts AS (
      SELECT
        doctor_id,
        COUNT(*) AS performer_reserve_count,
        COUNT(*) AS performed_tests,
        ROUND(SUM(reserved_amount), 2) AS performer_reserve,
        ROUND(SUM(reserved_amount), 2) AS earned_commission,
        ROUND(SUM(reserved_amount), 2) AS payable_commission,
        ROUND(SUM(CASE WHEN reserve_status = 'paid' THEN reserved_amount ELSE 0 END), 2) AS paid_commission,
        ROUND(SUM(CASE WHEN reserve_status = 'paid' THEN 0 ELSE reserved_amount END), 2) AS outstanding_commission
      FROM performer_reserve_rows
      GROUP BY doctor_id
    ),
    referrer_commission_facts AS (
      SELECT
        NULLIF(dca.doctor_id, 0) AS doctor_id,
        ROUND(SUM(${reconciledCommissionAmountSql('dca')}), 2) AS referrer_commission,
        ROUND(SUM(${earnedCommissionAmountSql('dca')}), 2) AS earned_commission,
        ROUND(SUM(MAX(0, COALESCE(dca.doctor_waiver_amount, 0))), 2) AS doctor_waiver,
        ROUND(SUM(${reconciledCommissionAmountSql('dca')}), 2) AS payable_commission,
        ROUND(SUM(${paidCommissionAmountSql('dca')}), 2) AS paid_commission,
        ROUND(SUM(${outstandingCommissionAmountSql('dca')}), 2) AS outstanding_commission
      FROM doctor_commission_accruals dca
      JOIN bills commission_bill
        ON commission_bill.id = dca.bill_id
        AND commission_bill.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND ${localDateSql('dca.accrued_date, dca.created_at')} >= date(?)
        AND ${localDateSql('dca.accrued_date, dca.created_at')} <= date(?)
        AND (
          dca.source_type = 'referral'
          OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
        )
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND ${fullyPaidBillSql('commission_bill')}
      GROUP BY doctor_id
    ),
    visit_other_commission_facts AS (
      SELECT
        NULLIF(dca.doctor_id, 0) AS doctor_id,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'consultation_fee' THEN ${reconciledCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS visit_commission,
        ROUND(SUM(CASE
          WHEN dca.source_type IN ('procedure', 'ipd_round') THEN ${reconciledCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS other_commission,
        ROUND(SUM(${earnedCommissionAmountSql('dca')}), 2) AS earned_commission,
        ROUND(SUM(MAX(0, COALESCE(dca.doctor_waiver_amount, 0))), 2) AS doctor_waiver,
        ROUND(SUM(${reconciledCommissionAmountSql('dca')}), 2) AS payable_commission,
        ROUND(SUM(${paidCommissionAmountSql('dca')}), 2) AS paid_commission,
        ROUND(SUM(${outstandingCommissionAmountSql('dca')}), 2) AS outstanding_commission
      FROM doctor_commission_accruals dca
      LEFT JOIN bills commission_bill
        ON commission_bill.id = dca.bill_id
        AND commission_bill.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND ${localDateSql('dca.accrued_date, dca.created_at')} >= date(?)
        AND ${localDateSql('dca.accrued_date, dca.created_at')} <= date(?)
        AND dca.source_type IN ('consultation_fee', 'procedure', 'ipd_round')
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND (
          dca.source_type != 'consultation_fee'
          OR ${fullyPaidBillSql('commission_bill')}
        )
      GROUP BY doctor_id
    ),
    commission_rows AS (
      SELECT
        doctor_id,
        visit_commission,
        0.0 AS referrer_commission,
        other_commission,
        earned_commission,
        doctor_waiver,
        payable_commission,
        paid_commission,
        outstanding_commission
      FROM visit_other_commission_facts

      UNION ALL

      SELECT
        doctor_id,
        0.0 AS visit_commission,
        referrer_commission,
        0.0 AS other_commission,
        earned_commission,
        doctor_waiver,
        payable_commission,
        paid_commission,
        outstanding_commission
      FROM referrer_commission_facts
    ),
    commission_facts AS (
      SELECT
        doctor_id,
        ROUND(SUM(visit_commission), 2) AS visit_commission,
        ROUND(SUM(referrer_commission), 2) AS referrer_commission,
        ROUND(SUM(other_commission), 2) AS other_commission,
        ROUND(SUM(earned_commission), 2) AS earned_commission,
        ROUND(SUM(doctor_waiver), 2) AS doctor_waiver,
        ROUND(SUM(payable_commission), 2) AS payable_commission,
        ROUND(SUM(paid_commission), 2) AS paid_commission,
        ROUND(SUM(outstanding_commission), 2) AS outstanding_commission
      FROM commission_rows
      GROUP BY doctor_id
    ),
    doctor_keys AS (
      SELECT doctor_id FROM visit_facts
      UNION
      SELECT doctor_id FROM test_facts
      UNION
      SELECT doctor_id FROM collection_facts
      UNION
      SELECT doctor_id FROM commission_facts
      UNION
      SELECT doctor_id FROM performer_reserve_facts
    ),
    doctor_rows AS (
      SELECT
        dk.doctor_id,
        COALESCE(NULLIF(TRIM(d.name), ''), 'Unassigned Doctor') AS doctor_name,
        COALESCE(vf.visits, 0) AS visits,
        ROUND(COALESCE(colf.visit_collection, 0), 2) AS visit_collection,
        ROUND(COALESCE(cmf.visit_commission, 0), 2) AS visit_commission,
        COALESCE(tf.referred_tests, 0) AS tests,
        COALESCE(tf.referred_tests, 0) AS referred_tests,
        COALESCE(tf.discounted_tests, 0) AS discounted_tests,
        ROUND(COALESCE(tf.test_gross_amount, 0), 2) AS test_gross_amount,
        ROUND(COALESCE(tf.test_discount_amount, 0), 2) AS test_discount_amount,
        ROUND(COALESCE(colf.test_collection, 0), 2) AS test_collection,
        ROUND(COALESCE(cmf.referrer_commission, 0), 2) AS referrer_commission,
        COALESCE(prf.performer_reserve_count, 0) AS performer_reserve_count,
        COALESCE(prf.performed_tests, 0) AS performed_tests,
        ROUND(COALESCE(prf.performer_reserve, 0), 2) AS performer_reserve,
        ROUND(COALESCE(cmf.referrer_commission, 0) + COALESCE(prf.performer_reserve, 0), 2) AS test_commission,
        ROUND(COALESCE(cmf.other_commission, 0), 2) AS other_commission,
        ROUND(COALESCE(cmf.earned_commission, 0) + COALESCE(prf.earned_commission, 0), 2) AS earned_commission,
        ROUND(COALESCE(cmf.doctor_waiver, 0), 2) AS doctor_waiver,
        ROUND(COALESCE(cmf.payable_commission, 0) + COALESCE(prf.payable_commission, 0), 2) AS payable_commission,
        ROUND(COALESCE(cmf.paid_commission, 0) + COALESCE(prf.paid_commission, 0), 2) AS paid_commission,
        ROUND(COALESCE(cmf.outstanding_commission, 0) + COALESCE(prf.outstanding_commission, 0), 2) AS outstanding_commission,
        ROUND(COALESCE(cmf.payable_commission, 0) + COALESCE(prf.payable_commission, 0), 2) AS total_commission
      FROM doctor_keys dk
      LEFT JOIN doctors d ON d.id = dk.doctor_id AND d.tenant_id = ?
      LEFT JOIN visit_facts vf ON vf.doctor_id IS dk.doctor_id
      LEFT JOIN test_facts tf ON tf.doctor_id IS dk.doctor_id
      LEFT JOIN collection_facts colf ON colf.doctor_id IS dk.doctor_id
      LEFT JOIN commission_facts cmf ON cmf.doctor_id IS dk.doctor_id
      LEFT JOIN performer_reserve_facts prf ON prf.doctor_id IS dk.doctor_id
    ),
    filtered_rows AS (
      SELECT *
      FROM doctor_rows
      WHERE ${filterSql}
    )
    SELECT
      filtered_rows.*,
      COUNT(*) OVER () AS total_rows,
      COALESCE(SUM(visits) OVER (), 0) AS overall_visits,
      ROUND(COALESCE(SUM(visit_collection) OVER (), 0), 2) AS overall_visit_collection,
      ROUND(COALESCE(SUM(visit_commission) OVER (), 0), 2) AS overall_visit_commission,
      COALESCE(SUM(tests) OVER (), 0) AS overall_tests,
      COALESCE(SUM(referred_tests) OVER (), 0) AS overall_referred_tests,
      COALESCE(SUM(discounted_tests) OVER (), 0) AS overall_discounted_tests,
      ROUND(COALESCE(SUM(test_gross_amount) OVER (), 0), 2) AS overall_test_gross_amount,
      ROUND(COALESCE(SUM(test_discount_amount) OVER (), 0), 2) AS overall_test_discount_amount,
      ROUND(COALESCE(SUM(test_collection) OVER (), 0), 2) AS overall_test_collection,
      ROUND(COALESCE(SUM(referrer_commission) OVER (), 0), 2) AS overall_referrer_commission,
      COALESCE(SUM(performer_reserve_count) OVER (), 0) AS overall_performer_reserve_count,
      COALESCE(SUM(performed_tests) OVER (), 0) AS overall_performed_tests,
      ROUND(COALESCE(SUM(performer_reserve) OVER (), 0), 2) AS overall_performer_reserve,
      ROUND(COALESCE(SUM(test_commission) OVER (), 0), 2) AS overall_test_commission,
      ROUND(COALESCE(SUM(other_commission) OVER (), 0), 2) AS overall_other_commission,
      ROUND(COALESCE(SUM(earned_commission) OVER (), 0), 2) AS overall_earned_commission,
      ROUND(COALESCE(SUM(doctor_waiver) OVER (), 0), 2) AS overall_doctor_waiver,
      ROUND(COALESCE(SUM(payable_commission) OVER (), 0), 2) AS overall_payable_commission,
      ROUND(COALESCE(SUM(paid_commission) OVER (), 0), 2) AS overall_paid_commission,
      ROUND(COALESCE(SUM(outstanding_commission) OVER (), 0), 2) AS overall_outstanding_commission,
      ROUND(COALESCE(SUM(total_commission) OVER (), 0), 2) AS overall_total_commission
    FROM filtered_rows
    ORDER BY ${sortColumn} ${direction}, doctor_name ASC
    LIMIT ? OFFSET ?
  `;
}

function summaryParams(args: {
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  filterValue?: string | number;
  pageSize: number;
  offset: number;
}): unknown[] {
  const { tenantId, period, filterValue, pageSize, offset } = args;
  const params: unknown[] = [
    tenantId, period.startDate, period.endDate,
    tenantId,
    tenantId, tenantId,
    tenantId,
    period.startDate, period.endDate,
    tenantId,
    tenantId, period.startDate, period.endDate,
    tenantId, period.startDate, period.endDate,
    tenantId, period.startDate, period.endDate,
    tenantId, period.startDate, period.endDate,
    tenantId, period.startDate, period.endDate,
    tenantId,
  ];
  if (filterValue !== undefined) params.push(filterValue);
  params.push(pageSize, offset);
  return params;
}

function mapDoctorDetailsSummary(row: DoctorPerformanceDbRow | undefined): DoctorPerformanceDetailsSummary {
  return {
    visits: wholeNumber(row?.visits ?? row?.overall_visits),
    visitCollection: roundMoney(row?.visit_collection ?? row?.overall_visit_collection),
    referredTests: wholeNumber(row?.referred_tests ?? row?.overall_referred_tests ?? row?.tests ?? row?.overall_tests),
    discountedTests: wholeNumber(row?.discounted_tests ?? row?.overall_discounted_tests),
    testGrossAmount: roundMoney(row?.test_gross_amount ?? row?.overall_test_gross_amount),
    testDiscountAmount: roundMoney(row?.test_discount_amount ?? row?.overall_test_discount_amount),
    testCollection: roundMoney(row?.test_collection ?? row?.overall_test_collection),
    performedTests: wholeNumber(row?.performed_tests ?? row?.overall_performed_tests ?? row?.performer_reserve_count),
    performerReserveAmount: roundMoney(row?.performer_reserve ?? row?.overall_performer_reserve),
    earnedCommission: roundMoney(row?.earned_commission ?? row?.overall_earned_commission),
    doctorWaiver: roundMoney(row?.doctor_waiver ?? row?.overall_doctor_waiver),
    payableCommission: roundMoney(row?.payable_commission ?? row?.overall_payable_commission ?? row?.total_commission),
    paidCommission: roundMoney(row?.paid_commission ?? row?.overall_paid_commission),
    outstandingCommission: roundMoney(row?.outstanding_commission ?? row?.overall_outstanding_commission),
  };
}

async function getDoctorDetailsSummary(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number | null;
}): Promise<DoctorPerformanceDetailsSummary> {
  const db = getDb(args.dbBinding);
  const result = await db.$client
    .prepare(doctorSummarySql('payableCommission', 'desc', args.doctorId))
    .bind(...summaryParams({
      tenantId: args.tenantId,
      period: args.period,
      filterValue: args.doctorId === null ? undefined : args.doctorId,
      pageSize: 1,
      offset: 0,
    }))
    .all<DoctorPerformanceDbRow>();
  return mapDoctorDetailsSummary(result.results?.[0]);
}

async function getLegacyDoctorPerformance(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  search?: string;
  sortBy?: DoctorPerformanceSort;
  sortDirection?: DoctorPerformanceSortDirection;
  page: number;
  pageSize: number;
}): Promise<DoctorPerformanceResponse> {
  const db = getDb(args.dbBinding);
  const search = (args.search ?? '').trim().slice(0, 80);
  const searchPattern = `%${search}%`;
  const sortBy = args.sortBy ?? 'totalCommission';
  const sortDirection = args.sortDirection ?? 'desc';
  const offset = (args.page - 1) * args.pageSize;
  const result = await db.$client
    .prepare(doctorSummarySql(sortBy, sortDirection))
    .bind(...summaryParams({
      tenantId: args.tenantId,
      period: args.period,
      filterValue: searchPattern,
      pageSize: args.pageSize,
      offset,
    }))
    .all<DoctorPerformanceDbRow>();

  const rawRows = result.results || [];
  const rows = rawRows.map((row): DoctorPerformanceRow => ({
    doctorId: row.doctor_id === null || row.doctor_id === undefined ? null : Number(row.doctor_id),
    doctorName: String(row.doctor_name || 'Unassigned Doctor'),
    visits: wholeNumber(row.visits),
    visitCollection: roundMoney(row.visit_collection),
    visitCommission: roundMoney(row.visit_commission),
    tests: wholeNumber(row.referred_tests ?? row.tests),
    referredTests: wholeNumber(row.referred_tests ?? row.tests),
    discountedTests: wholeNumber(row.discounted_tests),
    testGrossAmount: roundMoney(row.test_gross_amount),
    testDiscountAmount: roundMoney(row.test_discount_amount),
    testCollection: roundMoney(row.test_collection),
    referrerCommission: roundMoney(row.referrer_commission),
    performerReserveCount: wholeNumber(row.performed_tests ?? row.performer_reserve_count),
    performedTests: wholeNumber(row.performed_tests ?? row.performer_reserve_count),
    performerReserve: roundMoney(row.performer_reserve),
    testCommission: roundMoney(row.test_commission),
    otherCommission: roundMoney(row.other_commission),
    earnedCommission: roundMoney(row.earned_commission),
    doctorWaiver: roundMoney(row.doctor_waiver),
    payableCommission: roundMoney(row.payable_commission ?? row.total_commission),
    paidCommission: roundMoney(row.paid_commission),
    outstandingCommission: roundMoney(row.outstanding_commission),
    totalCommission: roundMoney(row.payable_commission ?? row.total_commission),
  }));
  const metadata = rawRows[0];
  const totalRows = wholeNumber(metadata?.total_rows);

  return {
    period: args.period,
    queryContract: LEGACY_DOCTOR_ANALYTICS_QUERY_CONTRACT,
    totals: {
      visits: wholeNumber(metadata?.overall_visits),
      visitCollection: roundMoney(metadata?.overall_visit_collection),
      visitCommission: roundMoney(metadata?.overall_visit_commission),
      tests: wholeNumber(metadata?.overall_referred_tests ?? metadata?.overall_tests),
      referredTests: wholeNumber(metadata?.overall_referred_tests ?? metadata?.overall_tests),
      discountedTests: wholeNumber(metadata?.overall_discounted_tests),
      testGrossAmount: roundMoney(metadata?.overall_test_gross_amount),
      testDiscountAmount: roundMoney(metadata?.overall_test_discount_amount),
      testCollection: roundMoney(metadata?.overall_test_collection),
      referrerCommission: roundMoney(metadata?.overall_referrer_commission),
      performerReserveCount: wholeNumber(metadata?.overall_performed_tests ?? metadata?.overall_performer_reserve_count),
      performedTests: wholeNumber(metadata?.overall_performed_tests ?? metadata?.overall_performer_reserve_count),
      performerReserve: roundMoney(metadata?.overall_performer_reserve),
      testCommission: roundMoney(metadata?.overall_test_commission),
      otherCommission: roundMoney(metadata?.overall_other_commission),
      earnedCommission: roundMoney(metadata?.overall_earned_commission),
      doctorWaiver: roundMoney(metadata?.overall_doctor_waiver),
      payableCommission: roundMoney(metadata?.overall_payable_commission ?? metadata?.overall_total_commission),
      paidCommission: roundMoney(metadata?.overall_paid_commission),
      outstandingCommission: roundMoney(metadata?.overall_outstanding_commission),
      totalCommission: roundMoney(metadata?.overall_payable_commission ?? metadata?.overall_total_commission),
    },
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}

function visitDetailsSql(doctorId: number | null): string {
  const doctorFilter = doctorId === null
    ? 'resolved_doctor_id IS NULL'
    : 'resolved_doctor_id = ?';
  return `/* executive_doctor:details:visits */
    WITH
    ${linePaymentAllocationCtes()},
    ${visitLinesCte()},
    bill_commission_doctors AS (
      SELECT
        dca.tenant_id,
        dca.bill_id,
        MAX(CASE WHEN dca.source_type = 'consultation_fee' THEN NULLIF(dca.doctor_id, 0) END) AS visit_commission_doctor_id
      FROM doctor_commission_accruals dca
      WHERE dca.tenant_id = ?
        AND dca.bill_id IS NOT NULL
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
      GROUP BY dca.tenant_id, dca.bill_id
    ),
    visit_details AS (
      SELECT
        'visit-line-' || CAST(vl.line_id AS TEXT) AS id,
        COALESCE(b.created_at, v.visit_date) AS occurred_at,
        pt.name AS patient_name,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
        vl.service_name,
        ROUND(vl.billed_amount, 2) AS billed_amount,
        ROUND(COALESCE(lc.collected_amount, 0), 2) AS collected_amount,
        ROUND(MAX(0, vl.billed_amount - COALESCE(lc.collected_amount, 0)), 2) AS due_amount,
        COALESCE(b.status, 'posted') AS status,
        COALESCE(
          NULLIF(bcd.visit_commission_doctor_id, 0),
          NULLIF(item_doctor.id, 0),
          NULLIF(v.doctor_id, 0),
          NULLIF(b.referring_doctor_id, 0)
        ) AS resolved_doctor_id
      FROM visit_lines vl
      JOIN bills b ON b.id = vl.bill_id AND b.tenant_id = vl.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = b.tenant_id
      LEFT JOIN invoice_items source_line
        ON source_line.id = vl.line_id
        AND source_line.tenant_id = vl.tenant_id
        AND source_line.bill_id = vl.bill_id
      LEFT JOIN doctors item_doctor
        ON item_doctor.id = source_line.reference_id
        AND item_doctor.tenant_id = source_line.tenant_id
      LEFT JOIN bill_commission_doctors bcd
        ON bcd.tenant_id = b.tenant_id
        AND bcd.bill_id = b.id
      LEFT JOIN line_collections lc
        ON lc.tenant_id = vl.tenant_id
        AND lc.bill_id = vl.bill_id
        AND lc.line_id = vl.line_id
      WHERE COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('b.created_at, v.visit_date, b.updated_at')} >= date(?)
        AND ${localDateSql('b.created_at, v.visit_date, b.updated_at')} <= date(?)
    )
    SELECT visit_details.*, COUNT(*) OVER () AS total_rows
    FROM visit_details
    WHERE ${doctorFilter}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
}

function testDetailsSql(
  doctorId: number | null,
  attribution: 'referring' | 'performing' = 'referring',
): string {
  const doctorColumn = attribution === 'performing' ? 'performing_doctor_id' : 'resolved_referring_doctor_id';
  const doctorFilter = doctorId === null
    ? `${doctorColumn} IS NULL`
    : `${doctorColumn} = ?`;
  return `/* executive_doctor:details:${attribution === 'performing' ? 'performed-tests' : 'tests'} */
    WITH
    ${linePaymentAllocationCtes()},
    bill_commission_doctors AS (
      SELECT
        dca.tenant_id,
        dca.bill_id,
        MAX(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN NULLIF(dca.doctor_id, 0)
        END) AS test_commission_doctor_id
      FROM doctor_commission_accruals dca
      WHERE dca.tenant_id = ?
        AND dca.bill_id IS NOT NULL
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
      GROUP BY dca.tenant_id, dca.bill_id
    ),
    referral_attribution AS (
      SELECT
        dca.lab_order_item_id,
        MAX(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN NULLIF(dca.doctor_id, 0)
        END) AS referring_doctor_id,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN ${earnedCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS test_commission,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN MAX(0, COALESCE(dca.performer_reserve_amount, 0))
          ELSE 0
        END), 2) AS performer_reserve_amount,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN MAX(0, COALESCE(dca.commission_base_amount, 0))
          ELSE 0
        END), 2) AS commission_base_amount,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN ${earnedCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS earned_amount,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN MAX(0, COALESCE(dca.doctor_waiver_amount, 0))
          ELSE 0
        END), 2) AS waiver_amount,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN ${reconciledCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS payable_amount,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN ${paidCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS paid_amount,
        ROUND(SUM(CASE
          WHEN dca.source_type = 'referral'
            OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
          THEN ${outstandingCommissionAmountSql('dca')}
          ELSE 0
        END), 2) AS outstanding_amount
      FROM doctor_commission_accruals dca
      JOIN bills commission_bill
        ON commission_bill.id = dca.bill_id
        AND commission_bill.tenant_id = dca.tenant_id
      WHERE dca.tenant_id = ?
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND dca.lab_order_item_id IS NOT NULL
        AND ${fullyPaidBillSql('commission_bill')}
      GROUP BY dca.lab_order_item_id
    ),
    performer_reserve_attribution AS (
      SELECT
        tenant_id,
        bill_id,
        invoice_item_id,
        CASE
          WHEN COUNT(DISTINCT NULLIF(assigned_doctor_id, 0)) = 1
            THEN MAX(NULLIF(assigned_doctor_id, 0))
          ELSE NULL
        END AS performing_doctor_id
      FROM diagnostic_performer_reserves
      WHERE LOWER(COALESCE(status, 'reserved')) NOT IN ('cancelled', 'reversed')
      GROUP BY tenant_id, bill_id, invoice_item_id
    ),
    performer_accrual_attribution AS (
      SELECT
        tenant_id,
        lab_order_item_id,
        CASE
          WHEN COUNT(DISTINCT NULLIF(doctor_id, 0)) = 1
            THEN MAX(NULLIF(doctor_id, 0))
          ELSE NULL
        END AS performing_doctor_id
      FROM doctor_commission_accruals
      WHERE source_type = 'lab_test'
        AND LOWER(COALESCE(incentive_type, '')) = 'performer'
        AND COALESCE(status, 'accrued') != 'cancelled'
        AND lab_order_item_id IS NOT NULL
      GROUP BY tenant_id, lab_order_item_id
    ),
    test_details AS (
      SELECT
        CASE WHEN loi.id IS NOT NULL THEN loi.id ELSE -ii.id END AS id,
        COALESCE(lo.order_date, lo.created_at, b.created_at) AS occurred_at,
        COALESCE(
          NULLIF(TRIM(loi.test_name), ''),
          NULLIF(TRIM(lt.name), ''),
          NULLIF(TRIM(ii.description), ''),
          'Test line #' || ii.id
        ) AS test_name,
        pt.name AS patient_name,
        COALESCE(NULLIF(TRIM(rd.name), ''), 'Unassigned Doctor') AS referring_doctor_name,
        COALESCE(NULLIF(TRIM(oc.name), ''), 'Unassigned Ordering Doctor') AS ordering_doctor_name,
        NULLIF(lo.ordering_clinician_doctor_id, 0) AS ordering_clinician_id,
        NULLIF(TRIM(oc.name), '') AS ordering_clinician_name,
        NULLIF(lo.ordered_by, 0) AS entered_by_user_id,
        NULLIF(TRIM(ou.name), '') AS entered_by_name,
        COALESCE(NULLIF(pra.performing_doctor_id, 0), NULLIF(paa.performing_doctor_id, 0)) AS performing_doctor_id,
        NULLIF(TRIM(pd.name), '') AS performing_doctor_name,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
        NULLIF(TRIM(loi.accession_no), '') AS accession_no,
        COALESCE(NULLIF(TRIM(loi.result_status), ''), NULLIF(TRIM(loi.status), ''), COALESCE(b.status, 'posted')) AS status,
        ROUND(MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1)), 2) AS gross_amount,
        ROUND(MAX(
          0,
          COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1) - COALESCE(ii.line_total, 0)
        ), 2) AS discount_amount,
        ROUND(MAX(0, COALESCE(ii.line_total, 0)), 2) AS net_billed_amount,
        ROUND(MAX(0, COALESCE(ii.line_total, 0)), 2) AS billed_amount,
        ROUND(COALESCE(lc.collected_amount, 0), 2) AS collected_amount,
        ROUND(MAX(0, COALESCE(ii.line_total, 0) - COALESCE(lc.collected_amount, 0)), 2) AS due_amount,
        ROUND(COALESCE(ra.performer_reserve_amount, 0), 2) AS performer_reserve_amount,
        ROUND(COALESCE(ra.commission_base_amount, 0), 2) AS commission_base_amount,
        ROUND(COALESCE(ra.earned_amount, 0), 2) AS earned_amount,
        ROUND(COALESCE(ra.waiver_amount, 0), 2) AS waiver_amount,
        ROUND(COALESCE(ra.payable_amount, 0), 2) AS payable_amount,
        ROUND(COALESCE(ra.paid_amount, 0), 2) AS paid_amount,
        ROUND(COALESCE(ra.outstanding_amount, 0), 2) AS outstanding_amount,
        ROUND(COALESCE(ra.test_commission, 0), 2) AS test_commission,
        COALESCE(
          NULLIF(b.referring_doctor_id, 0),
          NULLIF(bcd.test_commission_doctor_id, 0),
          NULLIF(ra.referring_doctor_id, 0),
          NULLIF(v.doctor_id, 0)
        ) AS resolved_referring_doctor_id
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN doctors vd ON vd.id = v.doctor_id AND vd.tenant_id = v.tenant_id
      LEFT JOIN lab_order_items loi
        ON loi.id = ii.reference_id
        AND loi.tenant_id = ii.tenant_id
        AND EXISTS (
          SELECT 1
          FROM lab_orders linked_order
          WHERE linked_order.id = loi.lab_order_id
            AND linked_order.tenant_id = loi.tenant_id
            AND linked_order.bill_id = b.id
        )
      LEFT JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
      LEFT JOIN lab_test_catalog lt ON lt.id = loi.lab_test_id AND lt.tenant_id = loi.tenant_id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = b.tenant_id
      LEFT JOIN bill_commission_doctors bcd ON bcd.tenant_id = b.tenant_id AND bcd.bill_id = b.id
      LEFT JOIN referral_attribution ra ON ra.lab_order_item_id = loi.id
      LEFT JOIN doctors rd ON rd.id = COALESCE(
        NULLIF(b.referring_doctor_id, 0),
        NULLIF(bcd.test_commission_doctor_id, 0),
        NULLIF(ra.referring_doctor_id, 0),
        NULLIF(v.doctor_id, 0)
      ) AND rd.tenant_id = ii.tenant_id
      LEFT JOIN users ou ON ou.id = lo.ordered_by AND ou.tenant_id = ii.tenant_id
      LEFT JOIN doctors oc
        ON oc.id = lo.ordering_clinician_doctor_id
        AND oc.tenant_id = ii.tenant_id
      LEFT JOIN performer_reserve_attribution pra
        ON pra.tenant_id = ii.tenant_id
        AND pra.bill_id = ii.bill_id
        AND pra.invoice_item_id = ii.id
      LEFT JOIN performer_accrual_attribution paa
        ON paa.tenant_id = ii.tenant_id
        AND paa.lab_order_item_id = loi.id
      LEFT JOIN doctors pd
        ON pd.id = COALESCE(NULLIF(pra.performing_doctor_id, 0), NULLIF(paa.performing_doctor_id, 0))
        AND pd.tenant_id = ii.tenant_id
      LEFT JOIN line_collections lc
        ON lc.tenant_id = ii.tenant_id
        AND lc.bill_id = ii.bill_id
        AND lc.line_id = ii.id
      WHERE ii.tenant_id = ?
        AND LOWER(TRIM(COALESCE(ii.item_category, ''))) = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('lo.order_date, lo.created_at, b.created_at, b.updated_at')} >= date(?)
        AND ${localDateSql('lo.order_date, lo.created_at, b.created_at, b.updated_at')} <= date(?)

      UNION ALL

      SELECT
        loi.id,
        COALESCE(lo.order_date, lo.created_at) AS occurred_at,
        COALESCE(NULLIF(TRIM(loi.test_name), ''), NULLIF(TRIM(lt.name), ''), 'Test #' || loi.lab_test_id) AS test_name,
        pt.name AS patient_name,
        COALESCE(NULLIF(TRIM(rd.name), ''), 'Unassigned Doctor') AS referring_doctor_name,
        COALESCE(NULLIF(TRIM(oc.name), ''), 'Unassigned Ordering Doctor') AS ordering_doctor_name,
        NULLIF(lo.ordering_clinician_doctor_id, 0) AS ordering_clinician_id,
        NULLIF(TRIM(oc.name), '') AS ordering_clinician_name,
        NULLIF(lo.ordered_by, 0) AS entered_by_user_id,
        NULLIF(TRIM(ou.name), '') AS entered_by_name,
        NULLIF(paa.performing_doctor_id, 0) AS performing_doctor_id,
        NULLIF(TRIM(pd.name), '') AS performing_doctor_name,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), CASE WHEN b.id IS NOT NULL THEN 'BILL-' || b.id END) AS invoice_no,
        NULLIF(TRIM(loi.accession_no), '') AS accession_no,
        COALESCE(NULLIF(TRIM(loi.result_status), ''), NULLIF(TRIM(loi.status), ''), 'pending') AS status,
        0.0 AS gross_amount,
        0.0 AS discount_amount,
        0.0 AS net_billed_amount,
        0.0 AS billed_amount,
        0.0 AS collected_amount,
        0.0 AS due_amount,
        ROUND(COALESCE(ra.performer_reserve_amount, 0), 2) AS performer_reserve_amount,
        ROUND(COALESCE(ra.commission_base_amount, 0), 2) AS commission_base_amount,
        ROUND(COALESCE(ra.earned_amount, 0), 2) AS earned_amount,
        ROUND(COALESCE(ra.waiver_amount, 0), 2) AS waiver_amount,
        ROUND(COALESCE(ra.payable_amount, 0), 2) AS payable_amount,
        ROUND(COALESCE(ra.paid_amount, 0), 2) AS paid_amount,
        ROUND(COALESCE(ra.outstanding_amount, 0), 2) AS outstanding_amount,
        ROUND(COALESCE(ra.test_commission, 0), 2) AS test_commission,
        COALESCE(
          NULLIF(b.referring_doctor_id, 0),
          NULLIF(bcd.test_commission_doctor_id, 0),
          NULLIF(ra.referring_doctor_id, 0),
          NULLIF(v.doctor_id, 0)
        ) AS resolved_referring_doctor_id
      FROM lab_order_items loi
      JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
      LEFT JOIN bills b ON b.id = lo.bill_id AND b.tenant_id = loi.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN doctors vd ON vd.id = v.doctor_id AND vd.tenant_id = v.tenant_id
      LEFT JOIN lab_test_catalog lt ON lt.id = loi.lab_test_id AND lt.tenant_id = loi.tenant_id
      LEFT JOIN patients pt ON pt.id = COALESCE(b.patient_id, lo.patient_id) AND pt.tenant_id = loi.tenant_id
      LEFT JOIN bill_commission_doctors bcd ON bcd.tenant_id = loi.tenant_id AND bcd.bill_id = b.id
      LEFT JOIN referral_attribution ra ON ra.lab_order_item_id = loi.id
      LEFT JOIN doctors rd ON rd.id = COALESCE(
        NULLIF(b.referring_doctor_id, 0),
        NULLIF(bcd.test_commission_doctor_id, 0),
        NULLIF(ra.referring_doctor_id, 0),
        NULLIF(v.doctor_id, 0)
      ) AND rd.tenant_id = loi.tenant_id
      LEFT JOIN users ou ON ou.id = lo.ordered_by AND ou.tenant_id = loi.tenant_id
      LEFT JOIN doctors oc
        ON oc.id = lo.ordering_clinician_doctor_id
        AND oc.tenant_id = loi.tenant_id
      LEFT JOIN performer_accrual_attribution paa
        ON paa.tenant_id = loi.tenant_id
        AND paa.lab_order_item_id = loi.id
      LEFT JOIN doctors pd
        ON pd.id = paa.performing_doctor_id
        AND pd.tenant_id = loi.tenant_id
      WHERE loi.tenant_id = ?
        AND LOWER(TRIM(COALESCE(loi.status, loi.result_status, 'pending'))) != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('lo.order_date, lo.created_at')} >= date(?)
        AND ${localDateSql('lo.order_date, lo.created_at')} <= date(?)
        AND NOT EXISTS (
          SELECT 1
          FROM invoice_items linked_invoice
          WHERE linked_invoice.tenant_id = loi.tenant_id
            AND linked_invoice.bill_id = lo.bill_id
            AND LOWER(TRIM(COALESCE(linked_invoice.item_category, ''))) = 'test'
            AND linked_invoice.reference_id = loi.id
            AND COALESCE(linked_invoice.status, 'active') != 'cancelled'
        )
    )
    SELECT test_details.*, COUNT(*) OVER () AS total_rows
    FROM test_details
    WHERE ${doctorFilter}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
}

interface CommissionDetailSchemaSupport {
  adjustments: boolean;
  accrualRuleId: boolean;
  ruleSnapshot: boolean;
  performerRuleId: boolean;
}

function commissionDetailsSql(
  doctorId: number | null,
  schema: CommissionDetailSchemaSupport = {
    adjustments: true,
    accrualRuleId: true,
    ruleSnapshot: true,
    performerRuleId: true,
  },
): string {
  const doctorFilter = doctorId === null ? 'resolved_doctor_id IS NULL' : 'resolved_doctor_id = ?';
  const adjustmentCte = schema.adjustments ? `
    adjustment_facts AS (
      SELECT
        adjustment.tenant_id,
        adjustment.accrual_id,
        ROUND(SUM(CASE
          WHEN adjustment.status = 'cancelled' THEN 0
          ELSE COALESCE(adjustment.amount, 0)
        END), 2) AS adjustment_amount
      FROM doctor_commission_adjustments adjustment
      GROUP BY adjustment.tenant_id, adjustment.accrual_id
    ),` : '';
  const adjustmentAmount = schema.adjustments
    ? '-ROUND(COALESCE(adjustments.adjustment_amount, 0), 2)'
    : '0.0';
  const manualAdjustmentReason = schema.adjustments
    ? "WHEN COALESCE(adjustments.adjustment_amount, 0) > 0 THEN 'manual_adjustment'"
    : '';
  const adjustmentJoin = schema.adjustments ? `
      LEFT JOIN adjustment_facts adjustments
        ON adjustments.tenant_id = dca.tenant_id
        AND adjustments.accrual_id = dca.id` : '';
  const ruleVersion = schema.ruleSnapshot
    ? 'dca.commission_rule_version_snapshot'
    : 'NULL';
  const accrualRuleId = schema.accrualRuleId ? 'dca.commission_rule_id' : 'NULL';
  const accrualRuleReason = schema.accrualRuleId
    ? "WHEN dca.commission_rule_id IS NULL THEN 'no_matching_rule'"
    : "WHEN 1 = 1 THEN 'no_matching_rule'";
  const storedReason = schema.ruleSnapshot ? `
          WHEN NULLIF(TRIM(dca.commission_reason_code), '') IS NOT NULL
            THEN dca.commission_reason_code` : '';
  const performerRuleId = schema.performerRuleId ? 'r.rule_id' : 'NULL';
  const performerRuleReason = schema.performerRuleId
    ? "WHEN r.rule_id IS NULL THEN 'no_matching_rule'"
    : "WHEN 1 = 1 THEN 'no_matching_rule'";

  return `/* executive_doctor:details:commissions */
    WITH${adjustmentCte}
    commission_details AS (
      SELECT
        dca.id,
        COALESCE(dca.accrued_date, dca.created_at) AS occurred_at,
        dca.source_type,
        dca.incentive_type,
        COALESCE(NULLIF(TRIM(d.name), ''), 'Unassigned Doctor') AS doctor_name,
        CASE
          WHEN dca.source_type IN ('lab_test', 'referral') THEN COALESCE(
            NULLIF(TRIM(loi.test_name), ''),
            NULLIF(TRIM(lt.name), ''),
            CASE WHEN dca.lab_test_id IS NOT NULL THEN 'Test #' || dca.lab_test_id END
          )
          ELSE NULL
        END AS detail_name,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'ACCRUAL-' || dca.id) AS reference_no,
        b.id AS bill_id,
        ${accrualRuleId} AS commission_rule_id,
        ${ruleVersion} AS commission_rule_version,
        ${adjustmentAmount} AS adjustment_amount,
        CASE${storedReason}
          WHEN LOWER(COALESCE(dca.status, 'accrued')) = 'cancelled' THEN 'cancelled'
          WHEN LOWER(COALESCE(b.status, 'open')) = 'refunded' THEN 'refunded'
          WHEN dca.source_type IN ('consultation_fee', 'referral', 'lab_test')
            AND NOT ${fullyPaidBillSql('b')}
            THEN 'bill_unpaid'
          WHEN COALESCE(dca.commission_base_amount, 0) <= 0 THEN 'eligible_base_zero'
          WHEN COALESCE(dca.doctor_waiver_amount, 0) > 0 THEN 'doctor_waived'
          ${accrualRuleReason}
          ${manualAdjustmentReason}
          ELSE 'rule_matched'
        END AS reason_code,
        ROUND(MAX(0, COALESCE(dca.gross_amount, 0)), 2) AS gross_amount,
        ROUND(MAX(
          0,
          COALESCE(dca.gross_amount, 0)
            - COALESCE(dca.performer_reserve_amount, 0)
            - COALESCE(dca.commission_base_amount, 0)
        ), 2) AS discount_amount,
        ROUND(MAX(
          0,
          COALESCE(dca.gross_amount, 0) - MAX(
            0,
            COALESCE(dca.gross_amount, 0)
              - COALESCE(dca.performer_reserve_amount, 0)
              - COALESCE(dca.commission_base_amount, 0)
          )
        ), 2) AS net_billed_amount,
        ROUND(MAX(0, COALESCE(dca.performer_reserve_amount, 0)), 2) AS performer_reserve_amount,
        ROUND(MAX(0, COALESCE(dca.commission_base_amount, 0)), 2) AS commission_base_amount,
        CASE
          WHEN COALESCE(dca.commission_rate_bps, 0) > 0
            THEN printf('%.2f%%', COALESCE(dca.commission_rate_bps, 0) / 100.0)
          WHEN COALESCE(dca.commission_flat_amount, 0) > 0
            THEN 'Flat BDT ' || printf('%.2f', COALESCE(dca.commission_flat_amount, 0))
          ELSE NULL
        END AS rate_label,
        ROUND(${earnedCommissionAmountSql('dca')}, 2) AS earned_amount,
        ROUND(MAX(0, COALESCE(dca.doctor_waiver_amount, 0)), 2) AS waiver_amount,
        ROUND(${reconciledCommissionAmountSql('dca')}, 2) AS payable_amount,
        ROUND(${paidCommissionAmountSql('dca')}, 2) AS paid_amount,
        ROUND(${outstandingCommissionAmountSql('dca')}, 2) AS outstanding_amount,
        NULLIF(TRIM(dcs.settlement_no), '') AS settlement_no,
        NULLIF(TRIM(dca.waiver_reason), '') AS waiver_reason,
        ROUND(${reconciledCommissionAmountSql('dca')}, 2) AS amount,
        COALESCE(dca.status, 'accrued') AS status,
        NULLIF(dca.doctor_id, 0) AS resolved_doctor_id
      FROM doctor_commission_accruals dca
      LEFT JOIN doctors d ON d.id = dca.doctor_id AND d.tenant_id = dca.tenant_id
      LEFT JOIN bills b ON b.id = dca.bill_id AND b.tenant_id = dca.tenant_id
      LEFT JOIN lab_order_items loi ON loi.id = dca.lab_order_item_id AND loi.tenant_id = dca.tenant_id
      LEFT JOIN lab_test_catalog lt
        ON lt.id = COALESCE(NULLIF(dca.lab_test_id, 0), NULLIF(loi.lab_test_id, 0))
        AND lt.tenant_id = dca.tenant_id
      LEFT JOIN doctor_commission_settlements dcs
        ON dcs.id = dca.settlement_id
        AND dcs.tenant_id = dca.tenant_id${adjustmentJoin}
      WHERE dca.tenant_id = ?
        AND ${localDateSql('dca.accrued_date, dca.created_at')} >= date(?)
        AND ${localDateSql('dca.accrued_date, dca.created_at')} <= date(?)
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
        AND (
          (
            dca.source_type = 'consultation_fee'
            AND ${fullyPaidBillSql('b')}
          )
          OR (
            (
              dca.source_type = 'referral'
              OR (dca.source_type = 'lab_test' AND LOWER(COALESCE(dca.incentive_type, '')) <> 'performer')
            )
            AND ${fullyPaidBillSql('b')}
          )
          OR dca.source_type IN ('procedure', 'ipd_round')
        )

      UNION ALL

      SELECT
        -r.id AS id,
        COALESCE(r.reserved_at, b.created_at) AS occurred_at,
        'performer_reserve' AS source_type,
        'performer' AS incentive_type,
        COALESCE(NULLIF(TRIM(d.name), ''), 'Unassigned Doctor') AS doctor_name,
        NULLIF(TRIM(r.test_name), '') AS detail_name,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'RESERVE-' || r.id) AS reference_no,
        r.bill_id AS bill_id,
        ${performerRuleId} AS commission_rule_id,
        NULL AS commission_rule_version,
        0.0 AS adjustment_amount,
        CASE
          WHEN LOWER(COALESCE(r.status, 'reserved')) = 'cancelled' THEN 'cancelled'
          WHEN LOWER(COALESCE(r.status, 'reserved')) = 'reversed' THEN 'reversal'
          WHEN COALESCE(r.reserved_amount, 0) <= 0 THEN 'eligible_base_zero'
          ${performerRuleReason}
          ELSE 'rule_matched'
        END AS reason_code,
        ROUND(MAX(0, COALESCE(r.unit_service_amount, 0)), 2) AS gross_amount,
        ROUND(MAX(0, COALESCE(r.unit_discount_amount, 0)), 2) AS discount_amount,
        ROUND(MAX(0, COALESCE(r.net_unit_service_amount, 0)), 2) AS net_billed_amount,
        ROUND(MAX(0, COALESCE(r.reserved_amount, 0)), 2) AS performer_reserve_amount,
        ROUND(MAX(0, COALESCE(r.net_unit_service_amount, 0)), 2) AS commission_base_amount,
        CASE
          WHEN LOWER(COALESCE(r.rule_rate_type, '')) = 'percent'
            THEN printf('%.2f%%', COALESCE(r.rule_rate_value, 0) / 100.0)
          WHEN LOWER(COALESCE(r.rule_rate_type, '')) = 'flat'
            THEN 'Flat BDT ' || printf('%.2f', COALESCE(r.rule_rate_value, 0))
          ELSE NULL
        END AS rate_label,
        ROUND(MAX(0, COALESCE(r.reserved_amount, 0)), 2) AS earned_amount,
        0.0 AS waiver_amount,
        ROUND(MAX(0, COALESCE(r.reserved_amount, 0)), 2) AS payable_amount,
        ROUND(CASE
          WHEN LOWER(COALESCE(r.status, 'reserved')) = 'paid' THEN MAX(0, COALESCE(r.reserved_amount, 0))
          ELSE 0
        END, 2) AS paid_amount,
        ROUND(CASE
          WHEN LOWER(COALESCE(r.status, 'reserved')) = 'paid' THEN 0
          ELSE MAX(0, COALESCE(r.reserved_amount, 0))
        END, 2) AS outstanding_amount,
        NULLIF(TRIM(drs.settlement_no), '') AS settlement_no,
        NULL AS waiver_reason,
        ROUND(COALESCE(r.reserved_amount, 0), 2) AS amount,
        COALESCE(r.status, 'reserved') AS status,
        NULLIF(r.assigned_doctor_id, 0) AS resolved_doctor_id
      FROM diagnostic_performer_reserves r
      JOIN bills b ON b.id = r.bill_id AND b.tenant_id = r.tenant_id
      LEFT JOIN doctors d ON d.id = r.assigned_doctor_id AND d.tenant_id = r.tenant_id
      LEFT JOIN doctor_commission_settlements drs
        ON drs.id = r.settlement_id
        AND drs.tenant_id = r.tenant_id
      WHERE r.tenant_id = ?
        AND ${localDateSql('b.created_at, r.reserved_at')} >= date(?)
        AND ${localDateSql('b.created_at, r.reserved_at')} <= date(?)
        AND LOWER(COALESCE(r.status, 'reserved')) NOT IN ('cancelled', 'reversed')
        AND COALESCE(r.reserved_amount, 0) > 0
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
    )
    SELECT
      id,
      occurred_at,
      source_type,
      incentive_type,
      doctor_name,
      detail_name,
      reference_no,
      bill_id,
      commission_rule_id,
      commission_rule_version,
      adjustment_amount,
      reason_code,
      gross_amount,
      discount_amount,
      net_billed_amount,
      performer_reserve_amount,
      commission_base_amount,
      rate_label,
      earned_amount,
      waiver_amount,
      payable_amount,
      paid_amount,
      outstanding_amount,
      settlement_no,
      waiver_reason,
      amount,
      status,
      COUNT(*) OVER () AS total_rows
    FROM commission_details
    WHERE ${doctorFilter}
    ORDER BY occurred_at DESC, id DESC
    LIMIT ? OFFSET ?
  `;
}

function visitDetailParams(args: {
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number | null;
  pageSize: number;
  offset: number;
}): unknown[] {
  const params: unknown[] = [
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId,
    args.tenantId, args.tenantId,
    args.tenantId,
    args.period.startDate, args.period.endDate,
  ];
  if (args.doctorId !== null) params.push(args.doctorId);
  params.push(args.pageSize, args.offset);
  return params;
}

function testDetailParams(args: {
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number | null;
  pageSize: number;
  offset: number;
}): unknown[] {
  const params: unknown[] = [
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId,
    args.tenantId,
    args.tenantId,
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId, args.period.startDate, args.period.endDate,
  ];
  if (args.doctorId !== null) params.push(args.doctorId);
  params.push(args.pageSize, args.offset);
  return params;
}

function commissionDetailParams(args: {
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number | null;
  pageSize: number;
  offset: number;
}): unknown[] {
  const params: unknown[] = [
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId, args.period.startDate, args.period.endDate,
  ];
  if (args.doctorId !== null) params.push(args.doctorId);
  params.push(args.pageSize, args.offset);
  return params;
}

function mapVisitRows(rows: DoctorDetailDbRow[]): DoctorVisitDetailRow[] {
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    occurredAt: String(row.occurred_at ?? ''),
    patientName: row.patient_name ?? null,
    invoiceNo: row.invoice_no ?? null,
    serviceName: String(row.service_name || 'Consultation'),
    billedAmount: roundMoney(row.billed_amount),
    collectedAmount: roundMoney(row.collected_amount),
    dueAmount: roundMoney(row.due_amount),
    status: row.status ?? null,
  }));
}

function mapTestRows(rows: DoctorDetailDbRow[]): DoctorTestDetailRow[] {
  return rows.map((row) => ({
    id: Number(row.id ?? 0),
    occurredAt: String(row.occurred_at ?? ''),
    testName: String(row.test_name || 'Unknown Test'),
    patientName: row.patient_name ?? null,
    referringDoctorName: String(row.referring_doctor_name || 'Unassigned Doctor'),
    orderingDoctorName: String(row.ordering_doctor_name || 'Unassigned Ordering Doctor'),
    orderingClinicianId: nullableId(row.ordering_clinician_id),
    orderingClinicianName: row.ordering_clinician_name ?? null,
    enteredByUserId: nullableId(row.entered_by_user_id),
    enteredByName: row.entered_by_name ?? null,
    performingDoctorId: nullableId(row.performing_doctor_id),
    performingDoctorName: row.performing_doctor_name ?? null,
    invoiceNo: row.invoice_no ?? null,
    accessionNo: row.accession_no ?? null,
    status: row.status ?? null,
    grossAmount: roundMoney(row.gross_amount),
    discountAmount: roundMoney(row.discount_amount),
    netBilledAmount: roundMoney(row.net_billed_amount ?? row.billed_amount),
    billedAmount: roundMoney(row.net_billed_amount ?? row.billed_amount),
    collectedAmount: roundMoney(row.collected_amount),
    dueAmount: roundMoney(row.due_amount),
    performerReserveAmount: roundMoney(row.performer_reserve_amount),
    commissionBaseAmount: roundMoney(row.commission_base_amount),
    earnedAmount: roundMoney(row.earned_amount),
    waiverAmount: roundMoney(row.waiver_amount),
    payableAmount: roundMoney(row.payable_amount ?? row.test_commission),
    paidAmount: roundMoney(row.paid_amount),
    outstandingAmount: roundMoney(row.outstanding_amount),
    testCommission: roundMoney(row.test_commission ?? row.earned_amount),
  }));
}

function mapCommissionRows(rows: DoctorDetailDbRow[]): DoctorCommissionDetailRow[] {
  return rows.map((row) => {
    const reasonCode = resolveCommissionReasonCode({
      storedReasonCode: row.reason_code,
      ruleId: row.commission_rule_id,
      status: row.status,
      eligibleBaseAmount: row.commission_base_amount,
      waiverAmount: row.waiver_amount,
      adjustmentAmount: row.adjustment_amount,
      payableAmount: row.payable_amount ?? row.amount,
    });
    return {
      id: Number(row.id ?? 0),
      occurredAt: String(row.occurred_at ?? ''),
      sourceType: String(row.source_type || 'other'),
      incentiveType: row.incentive_type ?? null,
      doctorName: String(row.doctor_name || 'Unassigned Doctor'),
      detailName: row.detail_name ?? null,
      referenceNo: row.reference_no ?? null,
      billId: nullableId(row.bill_id),
      commissionRuleId: nullableRuleId(row.commission_rule_id),
      commissionRuleVersion: nullableId(row.commission_rule_version),
      adjustmentAmount: roundMoney(row.adjustment_amount),
      reasonCode,
      reasonLabel: commissionReasonLabel(reasonCode),
      grossAmount: roundMoney(row.gross_amount),
      discountAmount: roundMoney(row.discount_amount),
      netBilledAmount: roundMoney(row.net_billed_amount),
      performerReserveAmount: roundMoney(row.performer_reserve_amount),
      commissionBaseAmount: roundMoney(row.commission_base_amount),
      rateLabel: row.rate_label ?? null,
      earnedAmount: roundMoney(row.earned_amount),
      waiverAmount: roundMoney(row.waiver_amount),
      payableAmount: roundMoney(row.payable_amount ?? row.amount),
      paidAmount: roundMoney(row.paid_amount),
      outstandingAmount: roundMoney(row.outstanding_amount),
      settlementNo: row.settlement_no ?? null,
      waiverReason: row.waiver_reason ?? null,
      amount: roundMoney(row.payable_amount ?? row.amount),
      status: row.status ?? null,
    };
  });
}

async function getLegacyDoctorPerformanceDetails(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  doctorId: number | null;
  tab: DoctorPerformanceDetailsTab;
  page: number;
  pageSize: number;
}): Promise<DoctorPerformanceDetailsResponse> {
  const db = getDb(args.dbBinding);
  const offset = (args.page - 1) * args.pageSize;
  let sql: string;
  let params: unknown[];
  let commissionSchema: CommissionDetailSchemaSupport | null = null;

  if (args.tab === 'visits') {
    sql = visitDetailsSql(args.doctorId);
    params = visitDetailParams({ ...args, offset });
  } else if (args.tab === 'tests' || args.tab === 'referred-tests') {
    sql = testDetailsSql(args.doctorId, 'referring');
    params = testDetailParams({ ...args, offset });
  } else if (args.tab === 'performed-tests') {
    sql = testDetailsSql(args.doctorId, 'performing');
    params = testDetailParams({ ...args, offset });
  } else {
    commissionSchema = {
      adjustments: true,
      accrualRuleId: true,
      ruleSnapshot: true,
      performerRuleId: true,
    };
    sql = commissionDetailsSql(args.doctorId, commissionSchema);
    params = commissionDetailParams({ ...args, offset });
  }

  const detailQuery = async () => {
    while (true) {
      try {
        return await db.$client.prepare(sql).bind(...params).all<DoctorDetailDbRow>();
      } catch (error) {
        if (!commissionSchema) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (commissionSchema.adjustments && /no such table:\s*doctor_commission_adjustments/i.test(message)) {
          commissionSchema = { ...commissionSchema, adjustments: false };
          sql = commissionDetailsSql(args.doctorId, commissionSchema);
          continue;
        }
        if (commissionSchema.accrualRuleId && /no such column:\s*dca\.commission_rule_id/i.test(message)) {
          commissionSchema = { ...commissionSchema, accrualRuleId: false };
          sql = commissionDetailsSql(args.doctorId, commissionSchema);
          continue;
        }
        if (
          commissionSchema.ruleSnapshot
          && /no such column:\s*dca\.(commission_rule_version_snapshot|commission_reason_code)/i.test(message)
        ) {
          commissionSchema = { ...commissionSchema, ruleSnapshot: false };
          sql = commissionDetailsSql(args.doctorId, commissionSchema);
          continue;
        }
        if (commissionSchema.performerRuleId && /no such column:\s*r\.rule_id/i.test(message)) {
          commissionSchema = { ...commissionSchema, performerRuleId: false };
          sql = commissionDetailsSql(args.doctorId, commissionSchema);
          continue;
        }
        throw error;
      }
    }
  };

  const [summary, result] = await Promise.all([
    getDoctorDetailsSummary({
      dbBinding: args.dbBinding,
      tenantId: args.tenantId,
      period: args.period,
      doctorId: args.doctorId,
    }),
    detailQuery(),
  ]);
  const rawRows = result.results || [];
  const totalRows = wholeNumber(rawRows[0]?.total_rows);
  const isTestTab = args.tab === 'tests'
    || args.tab === 'referred-tests'
    || args.tab === 'performed-tests';
  const rows = args.tab === 'visits'
    ? mapVisitRows(rawRows)
    : isTestTab
      ? mapTestRows(rawRows)
      : mapCommissionRows(rawRows);

  return {
    period: args.period,
    queryContract: LEGACY_DOCTOR_ANALYTICS_QUERY_CONTRACT,
    doctorId: args.doctorId,
    tab: args.tab,
    summary,
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}

export async function getDoctorPerformance(
  args: Parameters<typeof getLegacyDoctorPerformance>[0],
): Promise<DoctorPerformanceResponse> {
  const mode = await resolveDoctorAnalyticsProviderMode(
    args.dbBinding as unknown as DoctorAnalyticsProviderDatabase,
    args.tenantId,
  );
  if (mode === 'canonical') {
    return getCanonicalExecutiveDoctorPerformance({
      dbBinding: args.dbBinding as unknown as CanonicalExecutiveDoctorAnalyticsDatabase,
      tenantId: args.tenantId,
      period: args.period,
      search: args.search ?? '',
      sortBy: args.sortBy ?? 'totalCommission',
      sortDirection: args.sortDirection ?? 'desc',
      page: args.page,
      pageSize: args.pageSize,
    });
  }
  return getLegacyDoctorPerformance(args);
}

export async function getDoctorPerformanceDetails(
  args: Parameters<typeof getLegacyDoctorPerformanceDetails>[0],
): Promise<DoctorPerformanceDetailsResponse> {
  const mode = await resolveDoctorAnalyticsProviderMode(
    args.dbBinding as unknown as DoctorAnalyticsProviderDatabase,
    args.tenantId,
  );
  if (mode === 'canonical') {
    return getCanonicalExecutiveDoctorPerformanceDetails({
      dbBinding: args.dbBinding as unknown as CanonicalExecutiveDoctorAnalyticsDatabase,
      tenantId: args.tenantId,
      period: args.period,
      doctorId: args.doctorId,
      tab: args.tab,
      page: args.page,
      pageSize: args.pageSize,
    });
  }
  return getLegacyDoctorPerformanceDetails(args);
}
