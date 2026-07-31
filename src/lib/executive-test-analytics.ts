import { getDb } from '../db';
import type { Env } from '../types';
import type { ExecutiveDashboardPeriod } from './executive-dashboard-period';

export type TestPerformanceSort = 'quantity' | 'billed' | 'collected' | 'due' | 'testCommission';
export type TestPerformanceSortDirection = 'asc' | 'desc';
export type TestPerformanceDetailView = 'lines' | 'referred' | 'performed';

export interface TestPerformanceRow {
  testId: number;
  testCode: string | null;
  testName: string;
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
}

export interface TestPerformanceTotals {
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
}

export interface TestPerformanceResponse {
  period: ExecutiveDashboardPeriod;
  totals: TestPerformanceTotals;
  rows: TestPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface TestPerformanceDetailsSummary {
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
  performerReserve: number;
  referringDoctorCount: number;
  performingDoctorCount: number;
}

export interface TestPerformanceDetailRow {
  id: number;
  occurredAt: string;
  testName: string;
  patientName: string | null;
  quantity: number;
  referringDoctorId: number | null;
  referringDoctorName: string;
  orderingClinicianId: number | null;
  orderingClinicianName: string | null;
  enteredByUserId: number | null;
  enteredByName: string | null;
  performingDoctorId: number | null;
  performingDoctorName: string | null;
  invoiceNo: string | null;
  status: string | null;
  grossAmount: number;
  discountAmount: number;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  performerReserveAmount: number;
  testCommission: number;
}

export interface TestPerformanceReferredDoctorRow {
  doctorId: number | null;
  doctorName: string;
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
  discountedQuantity: number;
  discountAmount: number;
}

export interface TestPerformancePerformedDoctorRow {
  doctorId: number | null;
  doctorName: string;
  quantity: number;
  performerReserve: number;
  completed: number;
  pending: number;
}

export type TestPerformanceDetailsRow =
  | TestPerformanceDetailRow
  | TestPerformanceReferredDoctorRow
  | TestPerformancePerformedDoctorRow;

export interface TestPerformanceDetailsResponse {
  period: ExecutiveDashboardPeriod;
  testId: number;
  view: TestPerformanceDetailView;
  summary: TestPerformanceDetailsSummary;
  rows: TestPerformanceDetailsRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

type TestPerformanceDbRow = {
  test_id?: number | string | null;
  test_code?: string | null;
  test_name?: string | null;
  quantity?: number | string | null;
  billed?: number | string | null;
  collected?: number | string | null;
  due?: number | string | null;
  test_commission?: number | string | null;
  total_rows?: number | string | null;
  overall_quantity?: number | string | null;
  overall_billed?: number | string | null;
  overall_collected?: number | string | null;
  overall_due?: number | string | null;
  overall_test_commission?: number | string | null;
};

type TestPerformanceDetailDbRow = {
  id?: number | string | null;
  occurred_at?: string | null;
  test_name?: string | null;
  patient_name?: string | null;
  quantity?: number | string | null;
  doctor_id?: number | string | null;
  doctor_name?: string | null;
  referring_doctor_id?: number | string | null;
  referring_doctor_name?: string | null;
  ordering_clinician_id?: number | string | null;
  ordering_clinician_name?: string | null;
  entered_by_user_id?: number | string | null;
  entered_by_name?: string | null;
  performing_doctor_id?: number | string | null;
  performing_doctor_name?: string | null;
  invoice_no?: string | null;
  status?: string | null;
  gross_amount?: number | string | null;
  discount_amount?: number | string | null;
  billed_amount?: number | string | null;
  billed?: number | string | null;
  collected_amount?: number | string | null;
  collected?: number | string | null;
  due_amount?: number | string | null;
  due?: number | string | null;
  performer_reserve_amount?: number | string | null;
  performer_reserve?: number | string | null;
  test_commission?: number | string | null;
  discounted_quantity?: number | string | null;
  completed?: number | string | null;
  pending?: number | string | null;
  row_present?: number | string | null;
  total_rows?: number | string | null;
  overall_quantity?: number | string | null;
  overall_billed?: number | string | null;
  overall_collected?: number | string | null;
  overall_due?: number | string | null;
  overall_test_commission?: number | string | null;
  overall_performer_reserve?: number | string | null;
  referring_doctor_count?: number | string | null;
  performing_doctor_count?: number | string | null;
};

const SORT_COLUMNS: Record<TestPerformanceSort, string> = {
  quantity: 'quantity',
  billed: 'billed',
  collected: 'collected',
  due: 'due',
  testCommission: 'test_commission',
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

function localDateSql(expression: string): string {
  const value = expression.includes(',') ? `COALESCE(${expression})` : expression;
  return `CASE
    WHEN ${value} IS NULL THEN NULL
    WHEN ${value} LIKE '%Z' OR ${value} LIKE '%+00:00' OR ${value} LIKE '%-00:00'
      THEN date(${value}, '+6 hours')
    ELSE date(${value})
  END`;
}

function quantitySql(alias = 'ii'): string {
  return `CASE WHEN COALESCE(${alias}.quantity, 1) > 0 THEN COALESCE(${alias}.quantity, 1) ELSE 1 END`;
}

function lineAmountSql(alias = 'ii'): string {
  return `CASE
    WHEN COALESCE(${alias}.line_total, 0) > 0 THEN COALESCE(${alias}.line_total, 0)
    ELSE MAX(0, COALESCE(${alias}.unit_price, 0) * ${quantitySql(alias)})
  END`;
}

function paymentAllocationCtes(): string {
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
    active_bill_lines AS (
      SELECT
        ii.id AS line_id,
        ii.bill_id,
        ii.tenant_id,
        ii.item_category,
        ii.reference_id,
        ${lineAmountSql('ii')} AS line_amount
      FROM invoice_items ii
      WHERE ii.tenant_id = ?
        AND COALESCE(ii.status, 'active') != 'cancelled'
    ),
    bill_line_totals AS (
      SELECT tenant_id, bill_id, SUM(line_amount) AS allocation_base
      FROM active_bill_lines
      GROUP BY tenant_id, bill_id
    ),
    payment_allocations AS (
      SELECT
        pb.payment_id,
        pb.bill_id,
        pb.tenant_id,
        abl.line_id,
        abl.item_category,
        abl.reference_id,
        CASE
          WHEN blt.allocation_base > 0
            THEN 1.0 * pb.payment_amount * abl.line_amount / blt.allocation_base
          ELSE 0
        END AS allocated_amount
      FROM payment_base pb
      JOIN bill_line_totals blt ON blt.tenant_id = pb.tenant_id AND blt.bill_id = pb.bill_id
      JOIN active_bill_lines abl ON abl.tenant_id = pb.tenant_id AND abl.bill_id = pb.bill_id
    ),
    line_collections AS (
      SELECT tenant_id, line_id, ROUND(SUM(allocated_amount), 2) AS collected_amount
      FROM payment_allocations
      GROUP BY tenant_id, line_id
    )`;
}

function billingLinesCte(): string {
  return `
    raw_billing_lines AS (
      SELECT
        ii.id AS invoice_item_id,
        COALESCE(
          direct_bsi.id,
          linked_test.billing_service_item_id,
          (
            SELECT MIN(code_bsi.id)
            FROM billing_service_items code_bsi
            WHERE code_bsi.tenant_id = ii.tenant_id
              AND NULLIF(TRIM(linked_test.code), '') IS NOT NULL
              AND LOWER(TRIM(code_bsi.item_code)) = LOWER(TRIM(linked_test.code))
          )
        ) AS resolved_service_item_id,
        NULLIF(TRIM(ii.description), '') AS invoice_description,
        ${quantitySql('ii')} AS quantity,
        ${lineAmountSql('ii')} AS line_amount,
        ROUND(COALESCE(lc.collected_amount, 0), 2) AS collected_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN billing_service_items direct_bsi
        ON direct_bsi.id = ii.reference_id
        AND direct_bsi.tenant_id = ii.tenant_id
      LEFT JOIN lab_order_items linked_item
        ON linked_item.id = ii.reference_id
        AND linked_item.tenant_id = ii.tenant_id
      LEFT JOIN lab_test_catalog linked_test
        ON linked_test.id = linked_item.lab_test_id
        AND linked_test.tenant_id = linked_item.tenant_id
      LEFT JOIN line_collections lc
        ON lc.tenant_id = ii.tenant_id
        AND lc.line_id = ii.id
      WHERE ii.tenant_id = ?
        AND ii.item_category = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('b.created_at')} >= date(?)
        AND ${localDateSql('b.created_at')} <= date(?)
    ),
    billing_lines AS (
      SELECT
        CASE WHEN resolved_bsi.id IS NOT NULL THEN resolved_bsi.id ELSE -rbl.invoice_item_id END AS test_id,
        resolved_bsi.id AS service_item_id,
        NULLIF(TRIM(resolved_bsi.item_code), '') AS test_code,
        NULLIF(TRIM(resolved_bsi.item_name), '') AS service_test_name,
        rbl.invoice_description,
        COALESCE(
          NULLIF(TRIM(resolved_bsi.item_name), ''),
          rbl.invoice_description,
          'Unmapped test'
        ) AS test_name,
        rbl.quantity,
        rbl.line_amount,
        rbl.collected_amount
      FROM raw_billing_lines rbl
      LEFT JOIN billing_service_items resolved_bsi
        ON resolved_bsi.id = rbl.resolved_service_item_id
        AND resolved_bsi.tenant_id = ?
    )`;
}

function commissionCtes(mode: 'summary' | 'details', includeCommission: boolean): string {
  if (!includeCommission) {
    if (mode === 'summary') {
      return `
        commission_facts AS (
          SELECT CAST(NULL AS INTEGER) AS resolved_service_item_id, 0.0 AS test_commission
          WHERE 0
        )`;
    }
    return `
      commission_bill_service_facts AS (
        SELECT
          CAST(NULL AS INTEGER) AS resolved_bill_id,
          CAST(NULL AS INTEGER) AS resolved_service_item_id,
          0.0 AS test_commission
        WHERE 0
      )`;
  }

  const base = `
    commission_rows AS (
      SELECT
        COALESCE(
          direct_lt.billing_service_item_id,
          (
            SELECT MIN(direct_bsi.id)
            FROM billing_service_items direct_bsi
            WHERE direct_bsi.tenant_id = dca.tenant_id
              AND NULLIF(TRIM(direct_lt.code), '') IS NOT NULL
              AND LOWER(TRIM(direct_bsi.item_code)) = LOWER(TRIM(direct_lt.code))
          ),
          item_lt.billing_service_item_id,
          (
            SELECT MIN(item_bsi.id)
            FROM billing_service_items item_bsi
            WHERE item_bsi.tenant_id = dca.tenant_id
              AND NULLIF(TRIM(item_lt.code), '') IS NOT NULL
              AND LOWER(TRIM(item_bsi.item_code)) = LOWER(TRIM(item_lt.code))
          )
        ) AS resolved_service_item_id,
        COALESCE(dca.bill_id, item_order.bill_id) AS resolved_bill_id,
        ROUND(COALESCE(NULLIF(dca.earned_commission_amount, 0), dca.commission_amount, 0), 2) AS amount
      FROM doctor_commission_accruals dca
      LEFT JOIN lab_test_catalog direct_lt
        ON direct_lt.id = dca.lab_test_id
        AND direct_lt.tenant_id = dca.tenant_id
      LEFT JOIN lab_order_items commission_item
        ON commission_item.id = dca.lab_order_item_id
        AND commission_item.tenant_id = dca.tenant_id
      LEFT JOIN lab_orders item_order
        ON item_order.id = commission_item.lab_order_id
        AND item_order.tenant_id = commission_item.tenant_id
      LEFT JOIN lab_test_catalog item_lt
        ON item_lt.id = commission_item.lab_test_id
        AND item_lt.tenant_id = commission_item.tenant_id
      WHERE dca.tenant_id = ?
        AND ${localDateSql('dca.accrued_date, dca.created_at')} >= date(?)
        AND ${localDateSql('dca.accrued_date, dca.created_at')} <= date(?)
        AND dca.source_type IN ('lab_test', 'referral')
        AND COALESCE(dca.status, 'accrued') != 'cancelled'
    )`;

  if (mode === 'summary') {
    return `${base},
      commission_facts AS (
        SELECT
          resolved_service_item_id,
          ROUND(SUM(amount), 2) AS test_commission
        FROM commission_rows
        WHERE resolved_service_item_id IS NOT NULL
        GROUP BY resolved_service_item_id
      )`;
  }

  return `${base},
    commission_bill_service_facts AS (
      SELECT
        resolved_bill_id,
        resolved_service_item_id,
        ROUND(SUM(amount), 2) AS test_commission
      FROM commission_rows
      WHERE resolved_bill_id IS NOT NULL
        AND resolved_service_item_id IS NOT NULL
      GROUP BY resolved_bill_id, resolved_service_item_id
    )`;
}

function summarySql(args: {
  sortBy: TestPerformanceSort;
  sortDirection: TestPerformanceSortDirection;
  includeCommission: boolean;
}): string {
  const sortColumn = SORT_COLUMNS[args.sortBy];
  const direction = args.sortDirection === 'asc' ? 'ASC' : 'DESC';
  return `/* executive_test:summary */
    WITH
    ${paymentAllocationCtes()},
    ${billingLinesCte()},
    ${commissionCtes('summary', args.includeCommission)},
    billing_facts AS (
      SELECT
        test_id,
        MAX(service_item_id) AS service_item_id,
        MAX(test_code) AS test_code,
        MAX(service_test_name) AS service_test_name,
        MAX(test_name) AS test_name,
        GROUP_CONCAT(COALESCE(invoice_description, ''), ' ') AS invoice_description,
        SUM(quantity) AS quantity,
        ROUND(SUM(line_amount), 2) AS billed,
        ROUND(SUM(collected_amount), 2) AS collected,
        ROUND(MAX(0, SUM(line_amount) - SUM(collected_amount)), 2) AS due
      FROM billing_lines
      GROUP BY test_id
    ),
    test_rows AS (
      SELECT
        bf.test_id,
        bf.test_code,
        COALESCE(bf.service_test_name, bf.test_name, 'Unmapped test') AS test_name,
        bf.invoice_description,
        bf.quantity,
        bf.billed,
        bf.collected,
        bf.due,
        ROUND(COALESCE(cf.test_commission, 0), 2) AS test_commission
      FROM billing_facts bf
      LEFT JOIN commission_facts cf
        ON cf.resolved_service_item_id = bf.service_item_id
    ),
    filtered_rows AS (
      SELECT *
      FROM test_rows
      WHERE LOWER(COALESCE(test_code, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(test_name, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(invoice_description, '')) LIKE LOWER(?)
    )
    SELECT
      filtered_rows.*,
      COUNT(*) OVER () AS total_rows,
      COALESCE(SUM(quantity) OVER (), 0) AS overall_quantity,
      ROUND(COALESCE(SUM(billed) OVER (), 0), 2) AS overall_billed,
      ROUND(COALESCE(SUM(collected) OVER (), 0), 2) AS overall_collected,
      ROUND(COALESCE(SUM(due) OVER (), 0), 2) AS overall_due,
      ROUND(COALESCE(SUM(test_commission) OVER (), 0), 2) AS overall_test_commission
    FROM filtered_rows
    ORDER BY ${sortColumn} ${direction}, test_name ASC
    LIMIT ? OFFSET ?
  `;
}

function summaryParams(args: {
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  searchPattern: string;
  pageSize: number;
  offset: number;
  includeCommission: boolean;
}): unknown[] {
  const params: unknown[] = [
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId,
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId,
  ];
  if (args.includeCommission) {
    params.push(args.tenantId, args.period.startDate, args.period.endDate);
  }
  params.push(args.searchPattern, args.searchPattern, args.searchPattern, args.pageSize, args.offset);
  return params;
}

function isOptionalCommissionSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('no such table') || message.includes('no such column');
}

export async function getTestPerformance(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  search?: string;
  sortBy?: TestPerformanceSort;
  sortDirection?: TestPerformanceSortDirection;
  page: number;
  pageSize: number;
}): Promise<TestPerformanceResponse> {
  const db = getDb(args.dbBinding);
  const search = (args.search ?? '').trim().slice(0, 80);
  const searchPattern = `%${search}%`;
  const sortBy = args.sortBy ?? 'quantity';
  const sortDirection = args.sortDirection ?? 'desc';
  const offset = (args.page - 1) * args.pageSize;

  const run = (includeCommission: boolean) => db.$client
    .prepare(summarySql({ sortBy, sortDirection, includeCommission }))
    .bind(...summaryParams({
      tenantId: args.tenantId,
      period: args.period,
      searchPattern,
      pageSize: args.pageSize,
      offset,
      includeCommission,
    }))
    .all<TestPerformanceDbRow>();

  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run(true);
  } catch (error) {
    if (!isOptionalCommissionSchemaError(error)) throw error;
    result = await run(false);
  }

  const rawRows = result.results || [];
  const rows = rawRows.map((row): TestPerformanceRow => ({
    testId: Number(row.test_id),
    testCode: row.test_code ?? null,
    testName: String(row.test_name || 'Unmapped test'),
    quantity: wholeNumber(row.quantity),
    billed: roundMoney(row.billed),
    collected: roundMoney(row.collected),
    due: roundMoney(row.due),
    testCommission: roundMoney(row.test_commission),
  }));
  const metadata = rawRows[0];
  const totalRows = wholeNumber(metadata?.total_rows);

  return {
    period: args.period,
    totals: {
      quantity: wholeNumber(metadata?.overall_quantity),
      billed: roundMoney(metadata?.overall_billed),
      collected: roundMoney(metadata?.overall_collected),
      due: roundMoney(metadata?.overall_due),
      testCommission: roundMoney(metadata?.overall_test_commission),
    },
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}

function detailAttributionCtes(includeCommission: boolean): string {
  if (!includeCommission) {
    return `
      referral_line_attribution AS (
        SELECT
          CAST(NULL AS TEXT) AS tenant_id,
          CAST(NULL AS INTEGER) AS bill_id,
          CAST(NULL AS INTEGER) AS lab_order_item_id,
          CAST(NULL AS INTEGER) AS referring_doctor_id
        WHERE 0
      ),
      performer_reserve_attribution AS (
        SELECT
          CAST(NULL AS TEXT) AS tenant_id,
          CAST(NULL AS INTEGER) AS bill_id,
          CAST(NULL AS INTEGER) AS invoice_item_id,
          CAST(NULL AS INTEGER) AS performing_doctor_id,
          0.0 AS performer_reserve_amount
        WHERE 0
      ),
      performer_accrual_attribution AS (
        SELECT
          CAST(NULL AS TEXT) AS tenant_id,
          CAST(NULL AS INTEGER) AS bill_id,
          CAST(NULL AS INTEGER) AS lab_order_item_id,
          CAST(NULL AS INTEGER) AS performing_doctor_id,
          0.0 AS performer_reserve_amount
        WHERE 0
      )`;
  }

  return `
    referral_line_attribution AS (
      SELECT
        tenant_id,
        bill_id,
        lab_order_item_id,
        CASE
          WHEN COUNT(DISTINCT NULLIF(doctor_id, 0)) = 1 THEN MAX(NULLIF(doctor_id, 0))
          ELSE NULL
        END AS referring_doctor_id
      FROM doctor_commission_accruals
      WHERE source_type IN ('lab_test', 'referral')
        AND LOWER(COALESCE(incentive_type, 'referrer')) != 'performer'
        AND COALESCE(status, 'accrued') != 'cancelled'
      GROUP BY tenant_id, bill_id, lab_order_item_id
    ),
    performer_reserve_attribution AS (
      SELECT
        tenant_id,
        bill_id,
        invoice_item_id,
        CASE
          WHEN COUNT(DISTINCT NULLIF(assigned_doctor_id, 0)) = 1 THEN MAX(NULLIF(assigned_doctor_id, 0))
          ELSE NULL
        END AS performing_doctor_id,
        ROUND(SUM(MAX(0, COALESCE(reserved_amount, 0))), 2) AS performer_reserve_amount
      FROM diagnostic_performer_reserves
      WHERE LOWER(COALESCE(status, 'reserved')) NOT IN ('cancelled', 'reversed')
      GROUP BY tenant_id, bill_id, invoice_item_id
    ),
    performer_accrual_attribution AS (
      SELECT
        tenant_id,
        bill_id,
        lab_order_item_id,
        CASE
          WHEN COUNT(DISTINCT NULLIF(doctor_id, 0)) = 1 THEN MAX(NULLIF(doctor_id, 0))
          ELSE NULL
        END AS performing_doctor_id,
        ROUND(SUM(MAX(0, COALESCE(NULLIF(performer_reserve_amount, 0), earned_commission_amount, commission_amount, 0))), 2) AS performer_reserve_amount
      FROM doctor_commission_accruals
      WHERE source_type = 'lab_test'
        AND LOWER(COALESCE(incentive_type, '')) = 'performer'
        AND COALESCE(status, 'accrued') != 'cancelled'
      GROUP BY tenant_id, bill_id, lab_order_item_id
    )`;
}

function detailsSql(includeCommission: boolean, view: TestPerformanceDetailView): string {
  const viewRowsSql = view === 'referred'
    ? `SELECT
        referring_doctor_id AS doctor_id,
        MAX(referring_doctor_name) AS doctor_name,
        SUM(quantity) AS quantity,
        ROUND(SUM(billed_amount), 2) AS billed,
        ROUND(SUM(collected_amount), 2) AS collected,
        ROUND(SUM(due_amount), 2) AS due,
        ROUND(SUM(test_commission), 2) AS test_commission,
        SUM(CASE WHEN discount_amount > 0 THEN quantity ELSE 0 END) AS discounted_quantity,
        ROUND(SUM(discount_amount), 2) AS discount_amount
      FROM selected_lines
      GROUP BY referring_doctor_id`
    : view === 'performed'
      ? `SELECT
          performing_doctor_id AS doctor_id,
          MAX(performing_doctor_name) AS doctor_name,
          SUM(quantity) AS quantity,
          ROUND(SUM(performer_reserve_amount), 2) AS performer_reserve,
          SUM(CASE
            WHEN LOWER(COALESCE(status, 'pending')) IN ('completed', 'verified', 'final') THEN quantity
            ELSE 0
          END) AS completed,
          SUM(CASE
            WHEN LOWER(COALESCE(status, 'pending')) IN ('completed', 'verified', 'final') THEN 0
            ELSE quantity
          END) AS pending
        FROM selected_lines
        GROUP BY performing_doctor_id`
      : `SELECT * FROM selected_lines`;
  const orderBy = view === 'lines'
    ? 'occurred_at DESC, id DESC'
    : 'quantity DESC, doctor_name ASC';

  return `/* executive_test:details */
    WITH
    ${paymentAllocationCtes()},
    ${commissionCtes('details', includeCommission)},
    ${detailAttributionCtes(includeCommission)},
    raw_detail_base AS (
      SELECT
        ii.id,
        ii.bill_id,
        ii.tenant_id,
        COALESCE(
          direct_bsi.id,
          linked_test.billing_service_item_id,
          (
            SELECT MIN(code_bsi.id)
            FROM billing_service_items code_bsi
            WHERE code_bsi.tenant_id = ii.tenant_id
              AND NULLIF(TRIM(linked_test.code), '') IS NOT NULL
              AND LOWER(TRIM(code_bsi.item_code)) = LOWER(TRIM(linked_test.code))
          )
        ) AS resolved_service_item_id,
        b.created_at AS occurred_at,
        NULLIF(TRIM(ii.description), '') AS invoice_description,
        pt.name AS patient_name,
        ${quantitySql('ii')} AS quantity,
        COALESCE(NULLIF(rla.referring_doctor_id, 0), NULLIF(b.referring_doctor_id, 0), NULLIF(v.doctor_id, 0)) AS referring_doctor_id,
        COALESCE(NULLIF(TRIM(rd.name), ''), NULLIF(TRIM(b.referred_by_name), ''), 'Unassigned Referring Doctor') AS referring_doctor_name,
        NULLIF(lo.ordering_clinician_doctor_id, 0) AS ordering_clinician_id,
        NULLIF(TRIM(oc.name), '') AS ordering_clinician_name,
        NULLIF(lo.ordered_by, 0) AS entered_by_user_id,
        NULLIF(TRIM(ou.name), '') AS entered_by_name,
        COALESCE(NULLIF(pra.performing_doctor_id, 0), NULLIF(paa.performing_doctor_id, 0)) AS performing_doctor_id,
        COALESCE(NULLIF(TRIM(pd.name), ''), 'Unassigned Performing Doctor') AS performing_doctor_name,
        COALESCE(NULLIF(TRIM(b.invoice_no), ''), 'BILL-' || b.id) AS invoice_no,
        COALESCE(NULLIF(TRIM(linked_item.result_status), ''), NULLIF(TRIM(linked_item.status), ''), 'pending') AS status,
        ROUND(MAX(
          ${lineAmountSql('ii')},
          MAX(0, COALESCE(ii.unit_price, 0) * ${quantitySql('ii')})
        ), 2) AS gross_amount,
        ${lineAmountSql('ii')} AS billed_amount,
        ROUND(COALESCE(lc.collected_amount, 0), 2) AS collected_amount,
        ROUND(COALESCE(pra.performer_reserve_amount, paa.performer_reserve_amount, 0), 2) AS performer_reserve_amount
      FROM invoice_items ii
      JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
      LEFT JOIN billing_service_items direct_bsi
        ON direct_bsi.id = ii.reference_id
        AND direct_bsi.tenant_id = ii.tenant_id
      LEFT JOIN lab_order_items linked_item
        ON linked_item.id = ii.reference_id
        AND linked_item.tenant_id = ii.tenant_id
      LEFT JOIN lab_orders lo
        ON lo.id = linked_item.lab_order_id
        AND lo.tenant_id = linked_item.tenant_id
      LEFT JOIN lab_test_catalog linked_test
        ON linked_test.id = linked_item.lab_test_id
        AND linked_test.tenant_id = linked_item.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = ii.tenant_id
      LEFT JOIN referral_line_attribution rla
        ON rla.tenant_id = ii.tenant_id
        AND rla.bill_id = ii.bill_id
        AND rla.lab_order_item_id = linked_item.id
      LEFT JOIN performer_reserve_attribution pra
        ON pra.tenant_id = ii.tenant_id
        AND pra.bill_id = ii.bill_id
        AND pra.invoice_item_id = ii.id
      LEFT JOIN performer_accrual_attribution paa
        ON paa.tenant_id = ii.tenant_id
        AND paa.bill_id = ii.bill_id
        AND paa.lab_order_item_id = linked_item.id
      LEFT JOIN patients pt ON pt.id = b.patient_id AND pt.tenant_id = ii.tenant_id
      LEFT JOIN doctors rd
        ON rd.id = COALESCE(NULLIF(rla.referring_doctor_id, 0), NULLIF(b.referring_doctor_id, 0), NULLIF(v.doctor_id, 0))
        AND rd.tenant_id = ii.tenant_id
      LEFT JOIN doctors oc ON oc.id = lo.ordering_clinician_doctor_id AND oc.tenant_id = ii.tenant_id
      LEFT JOIN users ou ON ou.id = lo.ordered_by AND ou.tenant_id = ii.tenant_id
      LEFT JOIN doctors pd
        ON pd.id = COALESCE(NULLIF(pra.performing_doctor_id, 0), NULLIF(paa.performing_doctor_id, 0))
        AND pd.tenant_id = ii.tenant_id
      LEFT JOIN line_collections lc ON lc.tenant_id = ii.tenant_id AND lc.line_id = ii.id
      WHERE ii.tenant_id = ?
        AND ii.item_category = 'test'
        AND COALESCE(ii.status, 'active') != 'cancelled'
        AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        AND ${localDateSql('b.created_at')} >= date(?)
        AND ${localDateSql('b.created_at')} <= date(?)
    ),
    detail_base AS (
      SELECT
        rdb.id,
        CASE WHEN resolved_bsi.id IS NOT NULL THEN resolved_bsi.id ELSE -rdb.id END AS test_id,
        resolved_bsi.id AS service_item_id,
        rdb.bill_id,
        rdb.occurred_at,
        COALESCE(NULLIF(TRIM(resolved_bsi.item_name), ''), rdb.invoice_description, 'Unmapped test') AS test_name,
        rdb.patient_name,
        rdb.quantity,
        rdb.referring_doctor_id,
        rdb.referring_doctor_name,
        rdb.ordering_clinician_id,
        rdb.ordering_clinician_name,
        rdb.entered_by_user_id,
        rdb.entered_by_name,
        rdb.performing_doctor_id,
        rdb.performing_doctor_name,
        rdb.invoice_no,
        rdb.status,
        rdb.gross_amount,
        rdb.billed_amount,
        rdb.collected_amount,
        rdb.performer_reserve_amount,
        SUM(rdb.billed_amount) OVER (PARTITION BY rdb.bill_id, resolved_bsi.id) AS service_bill_total
      FROM raw_detail_base rdb
      LEFT JOIN billing_service_items resolved_bsi
        ON resolved_bsi.id = rdb.resolved_service_item_id
        AND resolved_bsi.tenant_id = ?
    ),
    detail_rows AS (
      SELECT
        db.id,
        db.test_id,
        db.occurred_at,
        db.test_name,
        db.patient_name,
        db.quantity,
        db.referring_doctor_id,
        db.referring_doctor_name,
        db.ordering_clinician_id,
        db.ordering_clinician_name,
        db.entered_by_user_id,
        db.entered_by_name,
        db.performing_doctor_id,
        db.performing_doctor_name,
        db.invoice_no,
        db.status,
        ROUND(db.gross_amount, 2) AS gross_amount,
        ROUND(MAX(0, db.gross_amount - db.billed_amount), 2) AS discount_amount,
        ROUND(db.billed_amount, 2) AS billed_amount,
        ROUND(db.collected_amount, 2) AS collected_amount,
        ROUND(MAX(0, db.billed_amount - db.collected_amount), 2) AS due_amount,
        ROUND(db.performer_reserve_amount, 2) AS performer_reserve_amount,
        ROUND(CASE
          WHEN db.service_item_id IS NOT NULL AND db.service_bill_total > 0
            THEN COALESCE(cbs.test_commission, 0) * db.billed_amount / db.service_bill_total
          ELSE 0
        END, 2) AS test_commission
      FROM detail_base db
      LEFT JOIN commission_bill_service_facts cbs
        ON cbs.resolved_bill_id = db.bill_id
        AND cbs.resolved_service_item_id = db.service_item_id
    ),
    selected_lines AS (
      SELECT *
      FROM detail_rows
      WHERE test_id = ?
    ),
    detail_summary AS (
      SELECT
        COALESCE(SUM(quantity), 0) AS overall_quantity,
        ROUND(COALESCE(SUM(billed_amount), 0), 2) AS overall_billed,
        ROUND(COALESCE(SUM(collected_amount), 0), 2) AS overall_collected,
        ROUND(COALESCE(SUM(due_amount), 0), 2) AS overall_due,
        ROUND(COALESCE(SUM(test_commission), 0), 2) AS overall_test_commission,
        ROUND(COALESCE(SUM(performer_reserve_amount), 0), 2) AS overall_performer_reserve,
        COUNT(DISTINCT referring_doctor_id) AS referring_doctor_count,
        COUNT(DISTINCT performing_doctor_id) AS performing_doctor_count
      FROM selected_lines
    ),
    view_rows AS (
      ${viewRowsSql}
    ),
    view_count AS (
      SELECT COUNT(*) AS total_rows
      FROM view_rows
    ),
    paginated_rows AS (
      SELECT view_rows.*, 1 AS row_present
      FROM view_rows
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    )
    SELECT
      paginated_rows.*,
      COALESCE(paginated_rows.row_present, 0) AS row_present,
      view_count.total_rows,
      detail_summary.*
    FROM detail_summary
    CROSS JOIN view_count
    LEFT JOIN paginated_rows ON 1 = 1
  `;
}

function detailsParams(args: {
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  testId: number;
  pageSize: number;
  offset: number;
  includeCommission: boolean;
}): unknown[] {
  const params: unknown[] = [
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId,
  ];
  if (args.includeCommission) {
    params.push(args.tenantId, args.period.startDate, args.period.endDate);
  }
  params.push(
    args.tenantId, args.period.startDate, args.period.endDate,
    args.tenantId,
    args.testId, args.pageSize, args.offset,
  );
  return params;
}

export async function getTestPerformanceDetails(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  testId: number;
  view?: TestPerformanceDetailView;
  page: number;
  pageSize: number;
}): Promise<TestPerformanceDetailsResponse> {
  const db = getDb(args.dbBinding);
  const view = args.view ?? 'lines';
  const offset = (args.page - 1) * args.pageSize;
  const run = (includeCommission: boolean) => db.$client
    .prepare(detailsSql(includeCommission, view))
    .bind(...detailsParams({ ...args, offset, includeCommission }))
    .all<TestPerformanceDetailDbRow>();

  let result: Awaited<ReturnType<typeof run>>;
  try {
    result = await run(true);
  } catch (error) {
    if (!isOptionalCommissionSchemaError(error)) throw error;
    result = await run(false);
  }

  const rawRows = result.results || [];
  const dataRows = rawRows.filter((row) => row.row_present === undefined || Number(row.row_present) === 1);
  const rows: TestPerformanceDetailsRow[] = view === 'referred'
    ? dataRows.map((row): TestPerformanceReferredDoctorRow => ({
      doctorId: nullableId(row.doctor_id),
      doctorName: String(row.doctor_name || 'Unassigned Referring Doctor'),
      quantity: wholeNumber(row.quantity),
      billed: roundMoney(row.billed),
      collected: roundMoney(row.collected),
      due: roundMoney(row.due),
      testCommission: roundMoney(row.test_commission),
      discountedQuantity: wholeNumber(row.discounted_quantity),
      discountAmount: roundMoney(row.discount_amount),
    }))
    : view === 'performed'
      ? dataRows.map((row): TestPerformancePerformedDoctorRow => ({
        doctorId: nullableId(row.doctor_id),
        doctorName: String(row.doctor_name || 'Unassigned Performing Doctor'),
        quantity: wholeNumber(row.quantity),
        performerReserve: roundMoney(row.performer_reserve),
        completed: wholeNumber(row.completed),
        pending: wholeNumber(row.pending),
      }))
      : dataRows.map((row): TestPerformanceDetailRow => ({
        id: Number(row.id),
        occurredAt: String(row.occurred_at || ''),
        testName: String(row.test_name || 'Unmapped test'),
        patientName: row.patient_name ?? null,
        quantity: wholeNumber(row.quantity),
        referringDoctorId: nullableId(row.referring_doctor_id),
        referringDoctorName: String(row.referring_doctor_name || 'Unassigned Referring Doctor'),
        orderingClinicianId: nullableId(row.ordering_clinician_id),
        orderingClinicianName: row.ordering_clinician_name ?? null,
        enteredByUserId: nullableId(row.entered_by_user_id),
        enteredByName: row.entered_by_name ?? null,
        performingDoctorId: nullableId(row.performing_doctor_id),
        performingDoctorName: row.performing_doctor_name ?? null,
        invoiceNo: row.invoice_no ?? null,
        status: row.status ?? null,
        grossAmount: roundMoney(row.gross_amount),
        discountAmount: roundMoney(row.discount_amount),
        billedAmount: roundMoney(row.billed_amount),
        collectedAmount: roundMoney(row.collected_amount),
        dueAmount: roundMoney(row.due_amount),
        performerReserveAmount: roundMoney(row.performer_reserve_amount),
        testCommission: roundMoney(row.test_commission),
      }));
  const metadata = rawRows[0];
  const totalRows = wholeNumber(metadata?.total_rows);

  return {
    period: args.period,
    testId: args.testId,
    view,
    summary: {
      quantity: wholeNumber(metadata?.overall_quantity),
      billed: roundMoney(metadata?.overall_billed),
      collected: roundMoney(metadata?.overall_collected),
      due: roundMoney(metadata?.overall_due),
      testCommission: roundMoney(metadata?.overall_test_commission),
      performerReserve: roundMoney(metadata?.overall_performer_reserve),
      referringDoctorCount: wholeNumber(metadata?.referring_doctor_count),
      performingDoctorCount: wholeNumber(metadata?.performing_doctor_count),
    },
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}
