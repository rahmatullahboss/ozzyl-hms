import { getDb } from '../db';
import type { Env } from '../types';
import type { ExecutiveDashboardPeriod } from './executive-dashboard-period';

export type ExpenseAnalysisSort = 'paidAmount' | 'transactions' | 'category';
export type ExpenseAnalysisSortDirection = 'asc' | 'desc';

export interface ExpenseAnalysisRow {
  id: string;
  occurredAt: string;
  category: string;
  detail: string;
  paidAmount: number;
  paymentMethod: string;
  status: string;
}

export interface ExpenseAnalysisResponse {
  period: ExecutiveDashboardPeriod;
  totals: { transactions: number; paidAmount: number };
  rows: ExpenseAnalysisRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

type ExpenseAnalysisDbRow = {
  id?: string | null;
  occurred_at?: string | null;
  category?: string | null;
  detail?: string | null;
  paid_amount?: number | string | null;
  payment_method?: string | null;
  status?: string | null;
  total_rows?: number | string | null;
  overall_transactions?: number | string | null;
  overall_paid_amount?: number | string | null;
};

const SORT_COLUMNS: Record<ExpenseAnalysisSort, string> = {
  paidAmount: 'paid_amount',
  // Preserve the existing public sort name while line-item rows no longer have
  // an aggregate transaction count. It now sorts by transaction occurrence.
  transactions: 'occurred_at',
  category: 'category',
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

function analysisSql(sortBy: ExpenseAnalysisSort, sortDirection: ExpenseAnalysisSortDirection): string {
  const sortColumn = SORT_COLUMNS[sortBy];
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  return `/* executive_expense:analysis */
    WITH expense_facts AS (
      SELECT
        'expense-' || CAST(e.id AS TEXT) AS id,
        COALESCE(NULLIF(TRIM(e.date), ''), m.created_at) AS occurred_at,
        COALESCE(NULLIF(TRIM(e.category), ''), 'other') AS category,
        COALESCE(NULLIF(TRIM(e.description), ''), 'No description provided') AS detail,
        COALESCE(e.amount, 0) AS paid_amount,
        COALESCE(NULLIF(TRIM(m.payment_method), ''), CASE WHEN e.cash_movement_id IS NOT NULL THEN 'cash' ELSE 'non_cash' END) AS payment_method,
        CASE
          WHEN e.cash_movement_id IS NOT NULL THEN 'paid'
          ELSE COALESCE(NULLIF(TRIM(e.payment_status), ''), NULLIF(TRIM(e.status), ''), 'paid')
        END AS status
      FROM expenses e
      LEFT JOIN cash_drawer_movements m ON m.id = e.cash_movement_id AND m.tenant_id = e.tenant_id
      WHERE e.tenant_id = ?
        AND e.date >= date(?)
        AND e.date <= date(?)
        AND COALESCE(e.status, 'approved') != 'rejected'
        AND (COALESCE(e.payment_status, 'unpaid') = 'paid' OR e.cash_movement_id IS NOT NULL)

      UNION ALL

      SELECT
        'doctor-payout-' || CAST(m.id AS TEXT) AS id,
        m.created_at AS occurred_at,
        'Doctor payouts' AS category,
        COALESCE(
          NULLIF(TRIM(m.description), ''),
          CASE
            WHEN m.reference_id IS NOT NULL AND TRIM(CAST(m.reference_id AS TEXT)) != ''
              THEN 'Doctor payout #' || CAST(m.reference_id AS TEXT)
            ELSE 'Doctor payout'
          END
        ) AS detail,
        COALESCE(m.amount, 0) AS paid_amount,
        COALESCE(NULLIF(TRIM(m.payment_method), ''), 'cash') AS payment_method,
        'paid' AS status
      FROM cash_drawer_movements m
      WHERE m.tenant_id = ?
        AND m.movement_type = 'cash_out'
        AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
        AND ${localDateSql('m.created_at')} >= date(?)
        AND ${localDateSql('m.created_at')} <= date(?)
    ),
    filtered_rows AS (
      SELECT *
      FROM expense_facts
      WHERE LOWER(category) LIKE LOWER(?)
         OR LOWER(detail) LIKE LOWER(?)
    )
    SELECT
      filtered_rows.*,
      COUNT(*) OVER () AS total_rows,
      COUNT(*) OVER () AS overall_transactions,
      ROUND(COALESCE(SUM(paid_amount) OVER (), 0), 2) AS overall_paid_amount
    FROM filtered_rows
    ORDER BY ${sortColumn} ${direction}, occurred_at DESC, id ASC
    LIMIT ? OFFSET ?
  `;
}

export async function getExpenseAnalysis(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: ExecutiveDashboardPeriod;
  search?: string;
  sortBy?: ExpenseAnalysisSort;
  sortDirection?: ExpenseAnalysisSortDirection;
  page: number;
  pageSize: number;
}): Promise<ExpenseAnalysisResponse> {
  const db = getDb(args.dbBinding);
  const sortBy = args.sortBy ?? 'paidAmount';
  const sortDirection = args.sortDirection ?? 'desc';
  const search = (args.search ?? '').trim().slice(0, 80);
  const searchPattern = `%${search}%`;
  const offset = (args.page - 1) * args.pageSize;
  const result = await db.$client.prepare(analysisSql(sortBy, sortDirection))
    .bind(
      args.tenantId, args.period.startDate, args.period.endDate,
      args.tenantId, args.period.startDate, args.period.endDate,
      searchPattern, searchPattern, args.pageSize, offset,
    )
    .all<ExpenseAnalysisDbRow>();
  const rawRows = result.results || [];
  const metadata = rawRows[0];
  const rows = rawRows.map((row): ExpenseAnalysisRow => ({
    id: String(row.id || ''),
    occurredAt: String(row.occurred_at || ''),
    category: String(row.category || 'other'),
    detail: String(row.detail || 'No description provided'),
    paidAmount: roundMoney(row.paid_amount),
    paymentMethod: String(row.payment_method || ''),
    status: String(row.status || ''),
  }));
  const totalRows = wholeNumber(metadata?.total_rows);
  return {
    period: args.period,
    totals: {
      transactions: wholeNumber(metadata?.overall_transactions),
      paidAmount: roundMoney(metadata?.overall_paid_amount),
    },
    rows,
    page: args.page,
    pageSize: args.pageSize,
    totalRows,
    hasNextPage: offset + rows.length < totalRows,
  };
}
