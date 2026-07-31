import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requirePermission } from '../../middleware/rbac';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getGlIncomeExpenseTotals, getGlMonthlyIncomeExpense } from '../../lib/accounting-reporting';
import { normalizeShareholderSettings } from '../../lib/shareholder-settings';
import { getDividendEligibleTypes } from '../../lib/shareholder-distribution';
import { buildCsv } from '../../lib/csv-export';

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
}).superRefine((value, ctx) => {
  if (!isStrictDate(value.from)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['from'], message: 'from is not a valid date' });
  }
  if (!isStrictDate(value.to)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to is not a valid date' });
  }
  if (value.from > value.to) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'to must be on or after from' });
  }
  if (isStrictDate(value.from) && isStrictDate(value.to) && inclusiveMonthCount(value.from, value.to) > 36) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['to'], message: 'Date range cannot exceed 36 months' });
  }
});

interface DistributionAggregateRow {
  id: number;
  month: string;
  total_profit: number;
  distributable_profit: number;
  retained_amount: number;
  status: string;
  approved_at: string | null;
  shareholder_count: number;
  gross_dividend: number;
  tax_withheld: number;
  net_payable: number;
  paid_amount: number;
  unpaid_amount: number;
}

interface ShareholderPortalData {
  range: { from: string; to: string };
  summary: {
    totalIncome: number;
    totalExpense: number;
    netProfit: number;
    estimatedRetainedEarnings: number;
    estimatedDistributableProfit: number;
    finalizedDividendTotal: number;
    paidDividendTotal: number;
    unpaidDividendTotal: number;
    latestFinalizedMonth: string | null;
    eligibleShareholderCount: number;
    eligibleShareCount: number;
  };
  policy: {
    profitPercentage: number;
    retainedEarningsPercentage: number;
  };
  trend: Array<{
    month: string;
    income: number;
    expense: number;
    profit: number;
    finalizedDividend: number;
    paidDividend: number;
    unpaidDividend: number;
  }>;
  distributions: Array<{
    id: number;
    month: string;
    totalProfit: number;
    distributableProfit: number;
    retainedAmount: number;
    status: string;
    approvedAt: string | null;
    shareholderCount: number;
    grossDividend: number;
    taxWithheld: number;
    netPayable: number;
    paidAmount: number;
    unpaidAmount: number;
  }>;
}

const shareholderPortalRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

export function isStrictDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function inclusiveMonthCount(from: string, to: string): number {
  const [fromYear, fromMonth] = from.slice(0, 7).split('-').map(Number);
  const [toYear, toMonth] = to.slice(0, 7).split('-').map(Number);
  return ((toYear - fromYear) * 12) + (toMonth - fromMonth) + 1;
}

function nextDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function enumerateMonths(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.slice(0, 7).split('-').map(Number);
  const [toYear, toMonth] = to.slice(0, 7).split('-').map(Number);
  const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, 1));
  const end = new Date(Date.UTC(toYear, toMonth - 1, 1));
  const months: string[] = [];
  while (cursor <= end) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function money(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round((numeric + Number.EPSILON) * 100) / 100 : 0;
}

export function normalizePercentage(value: unknown, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100 ? numeric : fallback;
}

async function writePortalAudit(
  db: D1Database,
  tenantId: string,
  userId: string,
  action: 'SHAREHOLDER_PORTAL_VIEW' | 'SHAREHOLDER_PORTAL_EXPORT',
  payload: Record<string, unknown>,
  ipAddress?: string,
  userAgent?: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO audit_logs (
       tenant_id, user_id, action, table_name, record_id,
       old_value, new_value, ip_address, user_agent, created_at
     ) VALUES (?, ?, ?, 'shareholder_portal', 0, NULL, ?, ?, ?, datetime('now'))`,
  ).bind(
    tenantId,
    userId,
    action,
    JSON.stringify(payload),
    ipAddress ?? null,
    userAgent ?? null,
  ).run();
}

async function loadPortalData(db: D1Database, tenantId: string, from: string, to: string): Promise<ShareholderPortalData> {
  const [financialTotals, monthlyFinancials, settingsResult, distributionsResult] = await Promise.all([
    getGlIncomeExpenseTotals(db, tenantId, from, to),
    getGlMonthlyIncomeExpense(db, tenantId, from, nextDate(to)),
    db.prepare(
      `SELECT key, value
       FROM settings
       WHERE tenant_id = ?
         AND key IN ('profit_percentage', 'retained_earnings_percent', 'dividend_eligible_types')`,
    ).bind(tenantId).all<{ key: string; value: string }>(),
    db.prepare(
      `SELECT
         pd.id,
         pd.month,
         pd.total_profit,
         pd.distributable_profit,
         COALESCE(pd.retained_amount, 0) AS retained_amount,
         COALESCE(pd.status, 'finalized') AS status,
         pd.approved_at,
         COUNT(sd.id) AS shareholder_count,
         COALESCE(SUM(COALESCE(sd.gross_dividend, sd.distribution_amount, 0)), 0) AS gross_dividend,
         COALESCE(SUM(COALESCE(sd.tax_deducted, 0)), 0) AS tax_withheld,
         COALESCE(SUM(COALESCE(sd.net_payable, sd.distribution_amount, 0)), 0) AS net_payable,
         COALESCE(SUM(CASE WHEN LOWER(COALESCE(sd.paid_status, 'unpaid')) = 'paid'
           THEN COALESCE(sd.net_payable, sd.distribution_amount, 0) ELSE 0 END), 0) AS paid_amount,
         COALESCE(SUM(CASE WHEN LOWER(COALESCE(sd.paid_status, 'unpaid')) <> 'paid'
           THEN COALESCE(sd.net_payable, sd.distribution_amount, 0) ELSE 0 END), 0) AS unpaid_amount
       FROM profit_distributions pd
       LEFT JOIN shareholder_distributions sd
         ON sd.distribution_id = pd.id
        AND sd.tenant_id = pd.tenant_id
       WHERE pd.tenant_id = ?
         AND pd.month >= ?
         AND pd.month <= ?
         AND LOWER(COALESCE(pd.status, 'finalized')) = 'finalized'
       GROUP BY pd.id, pd.month, pd.total_profit, pd.distributable_profit,
         pd.retained_amount, pd.status, pd.approved_at
       ORDER BY pd.month DESC, pd.id DESC`,
    ).bind(tenantId, from.slice(0, 7), to.slice(0, 7)).all<DistributionAggregateRow>(),
  ]);

  const settingsMap: Record<string, string> = {};
  for (const row of settingsResult.results ?? []) settingsMap[row.key] = row.value;
  const settings = normalizeShareholderSettings(settingsMap);
  const profitPercentage = normalizePercentage(settings.profit_percentage, 30);
  const retainedEarningsPercentage = normalizePercentage(settings.retained_earnings_percent, 0);
  const eligibleTypes = getDividendEligibleTypes(settings);
  const eligiblePlaceholders = eligibleTypes.map(() => '?').join(', ');

  const eligibleShareholders = await db.prepare(
    `SELECT COUNT(*) AS shareholder_count, COALESCE(SUM(share_count), 0) AS share_count
     FROM shareholders
     WHERE tenant_id = ?
       AND is_active = 1
       AND share_count > 0
       AND type IN (${eligiblePlaceholders})`,
  ).bind(tenantId, ...eligibleTypes).first<{ shareholder_count: number; share_count: number }>();

  const distributions = (distributionsResult.results ?? []).map((row) => ({
    id: Number(row.id),
    month: row.month,
    totalProfit: money(row.total_profit),
    distributableProfit: money(row.distributable_profit),
    retainedAmount: money(row.retained_amount),
    status: row.status,
    approvedAt: row.approved_at,
    shareholderCount: Number(row.shareholder_count ?? 0),
    grossDividend: money(row.gross_dividend),
    taxWithheld: money(row.tax_withheld),
    netPayable: money(row.net_payable),
    paidAmount: money(row.paid_amount),
    unpaidAmount: money(row.unpaid_amount),
  }));

  const glByMonth = new Map(monthlyFinancials.map((row) => [row.month, row]));
  const distributionByMonth = new Map<string, {
    finalizedDividend: number;
    paidDividend: number;
    unpaidDividend: number;
  }>();
  for (const distribution of distributions) {
    const current = distributionByMonth.get(distribution.month) ?? {
      finalizedDividend: 0,
      paidDividend: 0,
      unpaidDividend: 0,
    };
    distributionByMonth.set(distribution.month, {
      finalizedDividend: money(current.finalizedDividend + distribution.distributableProfit),
      paidDividend: money(current.paidDividend + distribution.paidAmount),
      unpaidDividend: money(current.unpaidDividend + distribution.unpaidAmount),
    });
  }
  const trend = enumerateMonths(from, to).map((month) => {
    const gl = glByMonth.get(month);
    const distribution = distributionByMonth.get(month);
    return {
      month,
      income: money(gl?.income),
      expense: money(gl?.expense),
      profit: money(gl?.profit),
      finalizedDividend: money(distribution?.finalizedDividend),
      paidDividend: money(distribution?.paidDividend),
      unpaidDividend: money(distribution?.unpaidDividend),
    };
  });

  const netProfit = money(financialTotals.profit);
  const estimatedRetainedEarnings = netProfit > 0
    ? money(Math.round(netProfit * (retainedEarningsPercentage / 100)))
    : 0;
  const estimatedDistributableProfit = netProfit > 0
    ? money(Math.max(0, Math.round((netProfit - estimatedRetainedEarnings) * (profitPercentage / 100))))
    : 0;

  return {
    range: { from, to },
    summary: {
      totalIncome: money(financialTotals.income),
      totalExpense: money(financialTotals.expense),
      netProfit,
      estimatedRetainedEarnings,
      estimatedDistributableProfit,
      finalizedDividendTotal: money(distributions.reduce((sum, row) => sum + row.netPayable, 0)),
      paidDividendTotal: money(distributions.reduce((sum, row) => sum + row.paidAmount, 0)),
      unpaidDividendTotal: money(distributions.reduce((sum, row) => sum + row.unpaidAmount, 0)),
      latestFinalizedMonth: distributions[0]?.month ?? null,
      eligibleShareholderCount: Number(eligibleShareholders?.shareholder_count ?? 0),
      eligibleShareCount: Number(eligibleShareholders?.share_count ?? 0),
    },
    policy: {
      profitPercentage,
      retainedEarningsPercentage,
    },
    trend,
    distributions,
  };
}

function portalCsv(data: ShareholderPortalData): string {
  const rows: unknown[][] = [
    ['Shareholder Financial Report'],
    ['From', data.range.from],
    ['To', data.range.to],
    [],
    ['Summary'],
    ['Metric', 'Amount / Value'],
    ['Total Income', data.summary.totalIncome],
    ['Total Expense', data.summary.totalExpense],
    ['Net Profit / Loss', data.summary.netProfit],
    ['Estimated Retained Earnings', data.summary.estimatedRetainedEarnings],
    ['Estimated Distributable Profit', data.summary.estimatedDistributableProfit],
    ['Finalized Dividend Total', data.summary.finalizedDividendTotal],
    ['Paid Dividend Total', data.summary.paidDividendTotal],
    ['Unpaid Dividend Total', data.summary.unpaidDividendTotal],
    ['Eligible Shareholders', data.summary.eligibleShareholderCount],
    ['Eligible Shares', data.summary.eligibleShareCount],
    [],
    ['Monthly Trend'],
    ['Month', 'Income', 'Expense', 'Profit / Loss', 'Finalized Dividend', 'Paid Dividend', 'Unpaid Dividend'],
    ...data.trend.map((row) => [
      row.month, row.income, row.expense, row.profit,
      row.finalizedDividend, row.paidDividend, row.unpaidDividend,
    ]),
    [],
    ['Finalized Distribution History'],
    ['Month', 'Total Profit', 'Distributable Profit', 'Retained Amount', 'Shareholder Count', 'Gross Dividend', 'Tax Withheld', 'Net Payable', 'Paid', 'Unpaid', 'Approved At'],
    ...data.distributions.map((row) => [
      row.month, row.totalProfit, row.distributableProfit, row.retainedAmount,
      row.shareholderCount, row.grossDividend, row.taxWithheld, row.netPayable,
      row.paidAmount, row.unpaidAmount, row.approvedAt ?? '',
    ]),
  ];
  return buildCsv(rows);
}

shareholderPortalRoutes.get(
  '/summary',
  requirePermission('shareholder_portal:read'),
  zValidator('query', dateRangeSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { from, to } = c.req.valid('query');
    const data = await loadPortalData(c.env.DB, tenantId, from, to);

    await writePortalAudit(
      c.env.DB,
      tenantId,
      userId,
      'SHAREHOLDER_PORTAL_VIEW',
      { from, to },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent'),
    );

    c.header('Cache-Control', 'private, no-store');
    return c.json(data);
  },
);

shareholderPortalRoutes.get(
  '/export.csv',
  requirePermission('shareholder_portal:read', 'shareholder_portal:export'),
  zValidator('query', dateRangeSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { from, to } = c.req.valid('query');
    const data = await loadPortalData(c.env.DB, tenantId, from, to);
    const csv = portalCsv(data);

    await writePortalAudit(
      c.env.DB,
      tenantId,
      userId,
      'SHAREHOLDER_PORTAL_EXPORT',
      { format: 'csv', from, to, rowCount: data.trend.length + data.distributions.length },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent'),
    );

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="shareholder-financial-report-${from}-to-${to}.csv"`);
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(csv);
  },
);

export default shareholderPortalRoutes;
