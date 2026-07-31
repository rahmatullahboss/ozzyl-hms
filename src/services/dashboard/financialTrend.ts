import type { FinancialReconciliationEnvelope } from '../../../packages/shared/src/dashboard';
import { getDb } from '../../db';
import { buildFinancialReconciliation } from '../../lib/dashboard/reconciliation';
import type { Env } from '../../types';
import type { FinancialControlPeriod } from './financialControl';

export type FinancialTrendSeries = 'collection' | 'expense' | 'result';
export type FinancialTrendGranularity = 'daily' | 'monthly';

export interface FinancialTrendPoint {
  bucket: string;
  label: string;
  collection: number;
  expense: number;
  result: number;
}

export interface FinancialTrendResponse {
  reportKey: 'admin_financial_trend';
  reportVersion: '1.0.0';
  generatedAt: string;
  timezone: 'Asia/Dhaka';
  currencyCode: 'BDT';
  moneyUnit: 'major';
  dateBasis: 'payment_and_paid_expense_date';
  granularity: FinancialTrendGranularity;
  period: FinancialControlPeriod;
  requestedSeries: FinancialTrendSeries[];
  points: FinancialTrendPoint[];
  totals: Record<FinancialTrendSeries, number>;
  reconciliation: Record<FinancialTrendSeries, FinancialReconciliationEnvelope>;
}

type TrendDbRow = {
  bucket?: string | null;
  amount?: number | string | null;
  row_count?: number | string | null;
};

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function localReportDate(expression: string): string {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function bucketExpression(dateExpression: string, granularity: FinancialTrendGranularity): string {
  const localDate = localReportDate(dateExpression);
  return granularity === 'monthly' ? `SUBSTR(${localDate}, 1, 7)` : localDate;
}

function mapRows(rows: TrendDbRow[]): Map<string, { amount: number; count: number }> {
  const mapped = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const bucket = String(row.bucket ?? '').trim();
    if (!bucket) continue;
    const current = mapped.get(bucket) ?? { amount: 0, count: 0 };
    current.amount = roundMoney(current.amount + roundMoney(row.amount));
    current.count += Math.max(0, Math.trunc(Number(row.row_count ?? 0)));
    mapped.set(bucket, current);
  }
  return mapped;
}

export async function getDashboardFinancialTrend(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: FinancialControlPeriod;
  requestedSeries: FinancialTrendSeries[];
  generatedAt?: string;
}): Promise<FinancialTrendResponse> {
  const db = getDb(args.dbBinding);
  const granularity: FinancialTrendGranularity = inclusiveDays(args.period.startDate, args.period.endDate) > 92
    ? 'monthly'
    : 'daily';
  const collectionBucket = bucketExpression('COALESCE(p.date, p.created_at)', granularity);
  const expenseDate = localReportDate('COALESCE(e.date, e.created_at)');
  const payoutDate = localReportDate('m.created_at');
  const expenseBucket = granularity === 'monthly' ? `SUBSTR(event_date, 1, 7)` : 'event_date';

  const [collectionResult, expenseResult] = await db.$client.batch([
    db.$client.prepare(`
      /* dashboard_financial_trend:collection */
      SELECT
        ${collectionBucket} AS bucket,
        ROUND(COALESCE(SUM(p.amount), 0), 2) AS amount,
        COUNT(*) AS row_count
      FROM payments p
      WHERE p.tenant_id = ?
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(args.tenantId, args.period.startDate, args.period.endDate),
    db.$client.prepare(`
      /* dashboard_financial_trend:expense */
      WITH expense_events AS (
        SELECT
          ${expenseDate} AS event_date,
          COALESCE(e.amount, 0) AS amount
        FROM expenses e
        WHERE e.tenant_id = ?
          AND ${expenseDate} >= date(?)
          AND ${expenseDate} <= date(?)
          AND COALESCE(e.status, 'approved') != 'rejected'
          AND (COALESCE(e.payment_status, 'unpaid') = 'paid' OR e.cash_movement_id IS NOT NULL)

        UNION ALL

        SELECT
          ${payoutDate} AS event_date,
          COALESCE(m.amount, 0) AS amount
        FROM cash_drawer_movements m
        WHERE m.tenant_id = ?
          AND ${payoutDate} >= date(?)
          AND ${payoutDate} <= date(?)
          AND m.movement_type = 'cash_out'
          AND m.reference_type IN ('doctor_commission_settlement', 'doctor_payout')
      )
      SELECT
        ${expenseBucket} AS bucket,
        ROUND(COALESCE(SUM(amount), 0), 2) AS amount,
        COUNT(*) AS row_count
      FROM expense_events
      WHERE event_date IS NOT NULL
      GROUP BY bucket
      ORDER BY bucket ASC
    `).bind(
      args.tenantId,
      args.period.startDate,
      args.period.endDate,
      args.tenantId,
      args.period.startDate,
      args.period.endDate,
    ),
  ]);

  const collectionRows = mapRows((collectionResult.results as TrendDbRow[] | undefined) ?? []);
  const expenseRows = mapRows((expenseResult.results as TrendDbRow[] | undefined) ?? []);
  const buckets = [...new Set([...collectionRows.keys(), ...expenseRows.keys()])].sort();
  const points = buckets.map((bucket) => {
    const collection = roundMoney(collectionRows.get(bucket)?.amount ?? 0);
    const expense = roundMoney(expenseRows.get(bucket)?.amount ?? 0);
    return {
      bucket,
      label: bucket,
      collection,
      expense,
      result: roundMoney(collection - expense),
    };
  });
  const totals = {
    collection: roundMoney(points.reduce((sum, point) => sum + point.collection, 0)),
    expense: roundMoney(points.reduce((sum, point) => sum + point.expense, 0)),
    result: roundMoney(points.reduce((sum, point) => sum + point.result, 0)),
  };
  const collectionRowCount = [...collectionRows.values()].reduce((sum, row) => sum + row.count, 0);
  const expenseRowCount = [...expenseRows.values()].reduce((sum, row) => sum + row.count, 0);
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  return {
    reportKey: 'admin_financial_trend',
    reportVersion: '1.0.0',
    generatedAt,
    timezone: 'Asia/Dhaka',
    currencyCode: 'BDT',
    moneyUnit: 'major',
    dateBasis: 'payment_and_paid_expense_date',
    granularity,
    period: args.period,
    requestedSeries: args.requestedSeries,
    points,
    totals,
    reconciliation: {
      collection: buildFinancialReconciliation({
        summaryTotal: totals.collection,
        detailTotal: roundMoney(points.reduce((sum, point) => sum + point.collection, 0)),
        detailRowCount: collectionRowCount,
        detailGrain: `one operational payment grouped ${granularity}`,
        checkedAt: generatedAt,
        providerMode: 'legacy',
      }),
      expense: buildFinancialReconciliation({
        summaryTotal: totals.expense,
        detailTotal: roundMoney(points.reduce((sum, point) => sum + point.expense, 0)),
        detailRowCount: expenseRowCount,
        detailGrain: `one paid expense or executed doctor payout grouped ${granularity}`,
        checkedAt: generatedAt,
        providerMode: 'legacy',
      }),
      result: buildFinancialReconciliation({
        summaryTotal: totals.result,
        detailTotal: roundMoney(totals.collection - totals.expense),
        detailRowCount: collectionRowCount + expenseRowCount,
        detailGrain: `${granularity} collection less paid expense`,
        checkedAt: generatedAt,
        providerMode: 'legacy',
      }),
    },
  };
}
