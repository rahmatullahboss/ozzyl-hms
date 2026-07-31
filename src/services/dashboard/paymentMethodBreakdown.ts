import type { FinancialReconciliationEnvelope } from '../../../packages/shared/src/dashboard';
import { getDb } from '../../db';
import { buildFinancialReconciliation } from '../../lib/dashboard/reconciliation';
import type { Env } from '../../types';
import type { FinancialControlPeriod } from './financialControl';

export type DashboardPaymentMethodKey =
  | 'cash'
  | 'bkash'
  | 'nagad'
  | 'card'
  | 'bank_transfer'
  | 'cheque'
  | 'unknown';

export interface DashboardPaymentMethodRow {
  key: DashboardPaymentMethodKey;
  label: string;
  amount: number;
  count: number;
}

export interface DashboardPaymentMethodShare extends DashboardPaymentMethodRow {
  percentage: number;
}

export interface DashboardPaymentMethodResponse {
  reportKey: 'admin_payment_methods';
  reportVersion: '1.0.0';
  generatedAt: string;
  timezone: 'Asia/Dhaka';
  currencyCode: 'BDT';
  moneyUnit: 'major';
  dateBasis: 'payment_date';
  period: FinancialControlPeriod;
  totalCollection: number;
  transactionCount: number;
  methods: DashboardPaymentMethodShare[];
  depositReceipts: number;
  depositTransactionCount: number;
  depositMethods: DashboardPaymentMethodRow[];
  depositTreatment: 'separate_liability_flow';
  reconciliation: FinancialReconciliationEnvelope;
}

type DbPaymentMethodRow = {
  method_key?: string | null;
  method_label?: string | null;
  amount?: number | string | null;
  row_count?: number | string | null;
};

const METHOD_ORDER: DashboardPaymentMethodKey[] = [
  'cash',
  'bkash',
  'nagad',
  'card',
  'bank_transfer',
  'cheque',
  'unknown',
];

const METHOD_LABELS: Record<DashboardPaymentMethodKey, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  unknown: 'Unknown',
};

function roundMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

function roundPercentage(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizeMethodKey(value: unknown): DashboardPaymentMethodKey {
  const normalized = String(value ?? '').trim().toLowerCase();
  return METHOD_ORDER.includes(normalized as DashboardPaymentMethodKey)
    ? normalized as DashboardPaymentMethodKey
    : 'unknown';
}

function mapRows(rows: DbPaymentMethodRow[]): DashboardPaymentMethodRow[] {
  const merged = new Map<DashboardPaymentMethodKey, DashboardPaymentMethodRow>();
  for (const row of rows) {
    const key = normalizeMethodKey(row.method_key);
    const existing = merged.get(key) ?? { key, label: METHOD_LABELS[key], amount: 0, count: 0 };
    existing.amount = roundMoney(existing.amount + roundMoney(row.amount));
    existing.count += Math.max(0, Math.trunc(Number(row.row_count ?? 0)));
    merged.set(key, existing);
  }
  return METHOD_ORDER
    .map((key) => merged.get(key))
    .filter((row): row is DashboardPaymentMethodRow => Boolean(row && (row.amount !== 0 || row.count !== 0)));
}

function localReportDate(expression: string): string {
  return `CASE
    WHEN ${expression} IS NULL THEN NULL
    WHEN ${expression} LIKE '%Z' OR ${expression} LIKE '%+00:00' OR ${expression} LIKE '%-00:00'
      THEN date(${expression}, '+6 hours')
    ELSE date(${expression})
  END`;
}

function methodKeyExpression(column: string): string {
  return `CASE
    WHEN LOWER(TRIM(COALESCE(${column}, 'cash'))) IN ('cash', 'cash payment') THEN 'cash'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('bkash', 'b-kash', 'b kash') THEN 'bkash'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) = 'nagad' THEN 'nagad'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('card', 'debit_card', 'debit card', 'credit_card', 'credit card') THEN 'card'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('bank', 'bank_transfer', 'bank transfer') THEN 'bank_transfer'
    WHEN LOWER(TRIM(COALESCE(${column}, ''))) IN ('cheque', 'check') THEN 'cheque'
    ELSE 'unknown'
  END`;
}

function methodLabelExpression(methodKey: string): string {
  return `CASE ${methodKey}
    WHEN 'cash' THEN 'Cash'
    WHEN 'bkash' THEN 'bKash'
    WHEN 'nagad' THEN 'Nagad'
    WHEN 'card' THEN 'Card'
    WHEN 'bank_transfer' THEN 'Bank Transfer'
    WHEN 'cheque' THEN 'Cheque'
    ELSE 'Unknown'
  END`;
}

export async function getDashboardPaymentMethodBreakdown(args: {
  dbBinding: Env['DB'];
  tenantId: string;
  period: FinancialControlPeriod;
  generatedAt?: string;
}): Promise<DashboardPaymentMethodResponse> {
  const db = getDb(args.dbBinding);
  const billingMethod = methodKeyExpression('p.payment_method');
  const depositMethod = methodKeyExpression('d.payment_method');
  const [billingResult, depositResult] = await db.$client.batch([
    db.$client.prepare(`
      /* dashboard_payment_methods:billing */
      SELECT
        ${billingMethod} AS method_key,
        ${methodLabelExpression(billingMethod)} AS method_label,
        ROUND(COALESCE(SUM(p.amount), 0), 2) AS amount,
        COUNT(*) AS row_count
      FROM payments p
      WHERE p.tenant_id = ?
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} >= date(?)
        AND ${localReportDate('COALESCE(p.date, p.created_at)')} <= date(?)
      GROUP BY method_key, method_label
      ORDER BY CASE method_key
        WHEN 'cash' THEN 1 WHEN 'bkash' THEN 2 WHEN 'nagad' THEN 3
        WHEN 'card' THEN 4 WHEN 'bank_transfer' THEN 5 WHEN 'cheque' THEN 6 ELSE 7 END
    `).bind(args.tenantId, args.period.startDate, args.period.endDate),
    db.$client.prepare(`
      /* dashboard_payment_methods:deposits */
      SELECT
        ${depositMethod} AS method_key,
        ${methodLabelExpression(depositMethod)} AS method_label,
        ROUND(COALESCE(SUM(d.amount), 0), 2) AS amount,
        COUNT(*) AS row_count
      FROM billing_deposits d
      WHERE d.tenant_id = ?
        AND ${localReportDate('d.created_at')} >= date(?)
        AND ${localReportDate('d.created_at')} <= date(?)
        AND COALESCE(d.is_active, 1) = 1
        AND LOWER(TRIM(COALESCE(d.transaction_type, 'deposit'))) = 'deposit'
        AND COALESCE(d.amount, 0) > 0
      GROUP BY method_key, method_label
      ORDER BY CASE method_key
        WHEN 'cash' THEN 1 WHEN 'bkash' THEN 2 WHEN 'nagad' THEN 3
        WHEN 'card' THEN 4 WHEN 'bank_transfer' THEN 5 WHEN 'cheque' THEN 6 ELSE 7 END
    `).bind(args.tenantId, args.period.startDate, args.period.endDate),
  ]);

  const methodRows = mapRows((billingResult.results as DbPaymentMethodRow[] | undefined) ?? []);
  const depositMethods = mapRows((depositResult.results as DbPaymentMethodRow[] | undefined) ?? []);
  const totalCollection = roundMoney(methodRows.reduce((sum, row) => sum + row.amount, 0));
  const transactionCount = methodRows.reduce((sum, row) => sum + row.count, 0);
  const depositReceipts = roundMoney(depositMethods.reduce((sum, row) => sum + row.amount, 0));
  const depositTransactionCount = depositMethods.reduce((sum, row) => sum + row.count, 0);
  const methods = methodRows.map((row) => ({
    ...row,
    percentage: totalCollection > 0 ? roundPercentage((row.amount / totalCollection) * 100) : 0,
  }));
  const generatedAt = args.generatedAt ?? new Date().toISOString();

  return {
    reportKey: 'admin_payment_methods',
    reportVersion: '1.0.0',
    generatedAt,
    timezone: 'Asia/Dhaka',
    currencyCode: 'BDT',
    moneyUnit: 'major',
    dateBasis: 'payment_date',
    period: args.period,
    totalCollection,
    transactionCount,
    methods,
    depositReceipts,
    depositTransactionCount,
    depositMethods,
    depositTreatment: 'separate_liability_flow',
    reconciliation: buildFinancialReconciliation({
      summaryTotal: totalCollection,
      detailTotal: roundMoney(methods.reduce((sum, row) => sum + row.amount, 0)),
      detailRowCount: transactionCount,
      detailGrain: 'one operational payment grouped by normalized payment method',
      checkedAt: generatedAt,
      providerMode: 'legacy',
    }),
  };
}
