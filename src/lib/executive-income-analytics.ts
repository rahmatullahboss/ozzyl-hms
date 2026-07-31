import { getDb } from '../db';
import type { Env } from '../types';
import type { ExecutiveDashboardPeriod } from './executive-dashboard-period';

export type IncomeServiceCategory = 'all' | 'lab' | 'non_lab';
export type IncomeServiceSort = 'collection' | 'transactions' | 'units' | 'serviceName';
export type IncomeServiceSortDirection = 'asc' | 'desc';

export interface IncomeServiceRow {
  serviceName: string;
  category: string;
  transactions: number;
  units: number;
  collection: number;
  share: number;
}

export interface IncomeServiceResponse {
  period: ExecutiveDashboardPeriod;
  totals: { transactions: number; units: number; collection: number };
  rows: IncomeServiceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

type IncomeServiceDbRow = {
  service_name?: string | null;
  category?: string | null;
  transactions?: number | string | null;
  units?: number | string | null;
  collection?: number | string | null;
  total_rows?: number | string | null;
  overall_transactions?: number | string | null;
  overall_units?: number | string | null;
  overall_collection?: number | string | null;
};

const SORT_COLUMNS: Record<IncomeServiceSort, string> = {
  collection: 'collection',
  transactions: 'transactions',
  units: 'units',
  serviceName: 'service_name',
};

function roundMoney(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function wholeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
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

function categorySql(column: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('test', 'lab', 'laboratory', 'diagnostic') THEN 'Lab'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('radiology', 'imaging') THEN 'Radiology'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('doctor_visit', 'consultation', 'opd', 'visit') THEN 'OPD'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('admission', 'ipd', 'bed', 'room', 'ward') THEN 'IPD'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('operation', 'ot', 'procedure', 'surgery') THEN 'OT'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('medicine', 'pharmacy', 'drug') THEN 'Pharmacy'
    ELSE 'Uncategorized'
  END`;
}

export function executivePaymentAllocationCte(): string {
  const itemCategory = `CASE WHEN pb.admission_id IS NOT NULL THEN 'IPD' ELSE ${categorySql('ii.item_category')} END`;
  return `
    WITH bill_payment_totals AS (
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
        CASE
          WHEN b.id IS NULL OR COALESCE(bpt.gross_payment_amount, 0) <= 0
            THEN COALESCE(p.amount, 0)
          ELSE COALESCE(p.amount, 0)
            * MIN(
                COALESCE(bpt.gross_payment_amount, 0),
                MAX(0, COALESCE(b.paid, bpt.gross_payment_amount))
              )
            / bpt.gross_payment_amount
        END AS payment_amount,
        COALESCE(p.date, p.created_at) AS occurred_at,
        p.receipt_no,
        p.payment_method,
        p.received_by,
        p.counter_session_id,
        p.tenant_id,
        b.invoice_no,
        b.patient_id,
        b.admission_id,
        b.created_at AS bill_created_at,
        COALESCE(b.total, 0) AS bill_total,
        COALESCE(b.discount, 0) AS discount_amount,
        COALESCE(b.paid, 0) AS paid_amount,
        COALESCE(b.due, 0) AS due_amount,
        b.discount_by_name,
        b.referred_by_name,
        b.discount_reason,
        COALESCE(b.test_bill, 0) AS test_bill,
        COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
        COALESCE(b.admission_bill, 0) AS admission_bill,
        COALESCE(b.operation_bill, 0) AS operation_bill,
        COALESCE(b.medicine_bill, 0) AS medicine_bill
      FROM payments p
      LEFT JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
      LEFT JOIN bill_payment_totals bpt ON bpt.bill_id = p.bill_id AND bpt.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
        AND ${localDateSql('p.date, p.created_at')} >= date(?)
        AND ${localDateSql('p.date, p.created_at')} <= date(?)
    ),
    active_items AS (
      SELECT
        ii.tenant_id,
        ii.bill_id,
        ${itemCategory} AS source_label,
        COALESCE(NULLIF(TRIM(ii.description), ''), 'Service') AS service_name,
        SUM(CASE
          WHEN COALESCE(ii.line_total, 0) > 0 THEN COALESCE(ii.line_total, 0)
          ELSE MAX(0, COALESCE(ii.unit_price, 0) * COALESCE(ii.quantity, 1))
        END) AS line_amount,
        SUM(MAX(1, COALESCE(ii.quantity, 1))) AS item_count
      FROM invoice_items ii
      JOIN (SELECT DISTINCT tenant_id, bill_id, admission_id FROM payment_base WHERE bill_id IS NOT NULL) pb
        ON pb.tenant_id = ii.tenant_id AND pb.bill_id = ii.bill_id
      WHERE COALESCE(ii.status, 'active') != 'cancelled'
      GROUP BY ii.tenant_id, ii.bill_id, source_label, service_name
    ),
    bill_item_totals AS (
      SELECT tenant_id, bill_id, SUM(line_amount) AS allocation_base
      FROM active_items
      GROUP BY tenant_id, bill_id
    ),
    payment_allocations AS (
      SELECT
        pb.*,
        ai.source_label,
        ai.service_name,
        ai.item_count,
        CASE
          WHEN bit.allocation_base > 0 THEN 1.0 * pb.payment_amount * ai.line_amount / bit.allocation_base
          ELSE 0
        END AS allocated_amount
      FROM payment_base pb
      JOIN bill_item_totals bit ON bit.tenant_id = pb.tenant_id AND bit.bill_id = pb.bill_id
      JOIN active_items ai ON ai.tenant_id = pb.tenant_id AND ai.bill_id = pb.bill_id

      UNION ALL

      SELECT
        pb.*,
        CASE
          WHEN pb.admission_id IS NOT NULL THEN 'IPD'
          WHEN pb.test_bill > 0 THEN 'Lab'
          WHEN pb.doctor_visit_bill > 0 THEN 'OPD'
          WHEN pb.admission_bill > 0 THEN 'IPD'
          WHEN pb.operation_bill > 0 THEN 'OT'
          WHEN pb.medicine_bill > 0 THEN 'Pharmacy'
          ELSE 'Uncategorized'
        END AS source_label,
        'Invoice payment' AS service_name,
        1 AS item_count,
        pb.payment_amount AS allocated_amount
      FROM payment_base pb
      LEFT JOIN bill_item_totals bit ON bit.tenant_id = pb.tenant_id AND bit.bill_id = pb.bill_id
      WHERE COALESCE(bit.allocation_base, 0) <= 0
    )
  `;
}

function categoryFilter(category: IncomeServiceCategory): string {
  if (category === 'lab') return "category = 'Lab'";
  if (category === 'non_lab') return "category != 'Lab'";
  return '1 = 1';
}

function analysisSql(args: {
  category: IncomeServiceCategory;
  sortBy: IncomeServiceSort;
  sortDirection: IncomeServiceSortDirection;
}): string {
  const sortColumn = SORT_COLUMNS[args.sortBy];
  const direction = args.sortDirection === 'asc' ? 'ASC' : 'DESC';
  return `/* executive_income:services */
    ${executivePaymentAllocationCte()},
    service_rows AS (
      SELECT
        service_name,
        source_label AS category,
        COUNT(DISTINCT payment_id) AS transactions,
        SUM(item_count) AS units,
        ROUND(SUM(allocated_amount), 2) AS collection
      FROM payment_allocations
      GROUP BY service_name, source_label
    ),
    filtered_rows AS (
      SELECT *
      FROM service_rows
      WHERE ${categoryFilter(args.category)}
        AND LOWER(service_name) LIKE LOWER(?)
    )
    SELECT
      filtered_rows.*,
      COUNT(*) OVER () AS total_rows,
      COALESCE(SUM(transactions) OVER (), 0) AS overall_transactions,
      COALESCE(SUM(units) OVER (), 0) AS overall_units,
      ROUND(COALESCE(SUM(collection) OVER (), 0), 2) AS overall_collection
    FROM filtered_rows
    ORDER BY ${sortColumn} ${direction}, service_name ASC
    LIMIT ? OFFSET ?
  `;
}

export async function getIncomeServiceAnalysis(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  category?: IncomeServiceCategory;
  search?: string;
  sortBy?: IncomeServiceSort;
  sortDirection?: IncomeServiceSortDirection;
  page: number;
  pageSize: number;
}): Promise<IncomeServiceResponse> {
  const db = getDb(args.dbBinding);
  const category = args.category ?? 'all';
  const sortBy = args.sortBy ?? 'collection';
  const sortDirection = args.sortDirection ?? 'desc';
  const search = (args.search ?? '').trim().slice(0, 80);
  const offset = (args.page - 1) * args.pageSize;
  const result = await db.$client.prepare(analysisSql({ category, sortBy, sortDirection }))
    .bind(args.tenantId, args.period.startDate, args.period.endDate, `%${search}%`, args.pageSize, offset)
    .all<IncomeServiceDbRow>();
  const rawRows = result.results || [];
  const metadata = rawRows[0];
  const overallCollection = roundMoney(metadata?.overall_collection);
  const rows = rawRows.map((row): IncomeServiceRow => {
    const collection = roundMoney(row.collection);
    return {
      serviceName: String(row.service_name || 'Unknown Service'),
      category: String(row.category || 'Other'),
      transactions: wholeNumber(row.transactions),
      units: wholeNumber(row.units),
      collection,
      share: overallCollection > 0 ? roundMoney(collection * 100 / overallCollection) : 0,
    };
  });
  const totalRows = wholeNumber(metadata?.total_rows);
  return {
    period: args.period,
    totals: {
      transactions: wholeNumber(metadata?.overall_transactions),
      units: wholeNumber(metadata?.overall_units),
      collection: overallCollection,
    },
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}
