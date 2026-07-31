import type { D1Database } from '@cloudflare/workers-types';

export interface GlIncomeExpenseTotals {
  income: number;
  expense: number;
  profit: number;
}

export interface GlBreakdownRow {
  name: string;
  code: string;
  amount: number;
  count: number;
}

export interface GlMonthlyRow {
  month: string;
  income: number;
  expense: number;
  profit: number;
}

function roundMoney(value: number): number {
  const numeric = Number(value || 0);
  const sign = numeric < 0 ? -1 : 1;
  const absolute = Math.abs(numeric);
  return sign * Number(`${Math.round(Number(`${absolute}e2`))}e-2`);
}

export async function getGlIncomeExpenseTotals(
  db: D1Database,
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<GlIncomeExpenseTotals> {
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit_amount - jl.debit_amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit_amount - jl.credit_amount ELSE 0 END), 0) AS expense
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN chart_of_accounts a ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND v.entry_date >= ?
      AND v.entry_date <= ?
      AND a.type IN ('revenue', 'expense')
  `).bind(tenantId, startDate, endDate).first<{ income: number; expense: number }>();

  const income = roundMoney(row?.income ?? 0);
  const expense = roundMoney(row?.expense ?? 0);
  return { income, expense, profit: roundMoney(income - expense) };
}

export async function getGlBreakdown(
  db: D1Database,
  tenantId: string,
  startDate: string,
  endDate: string,
  type: 'revenue' | 'expense',
): Promise<GlBreakdownRow[]> {
  const amountExpression = type === 'revenue'
    ? 'jl.credit_amount - jl.debit_amount'
    : 'jl.debit_amount - jl.credit_amount';

  const rows = await db.prepare(`
    SELECT
      a.name,
      a.code,
      COUNT(DISTINCT v.id) AS count,
      COALESCE(SUM(${amountExpression}), 0) AS amount
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN chart_of_accounts a ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND v.entry_date >= ?
      AND v.entry_date <= ?
      AND a.type = ?
    GROUP BY a.id, a.name, a.code
    HAVING ABS(amount) >= 0.01
    ORDER BY amount DESC
  `).bind(tenantId, startDate, endDate, type).all<{ name: string; code: string; amount: number; count: number }>();

  return (rows.results ?? []).map((row) => ({
    name: row.name,
    code: row.code,
    amount: roundMoney(row.amount),
    count: Number(row.count ?? 0),
  }));
}

export async function getGlMonthlyIncomeExpense(
  db: D1Database,
  tenantId: string,
  startDate: string,
  endExclusive: string,
): Promise<GlMonthlyRow[]> {
  const rows = await db.prepare(`
    SELECT
      strftime('%Y-%m', v.entry_date) AS month,
      COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit_amount - jl.debit_amount ELSE 0 END), 0) AS income,
      COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit_amount - jl.credit_amount ELSE 0 END), 0) AS expense
    FROM accounting_journal_lines jl
    JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
    JOIN chart_of_accounts a ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = ?
      AND v.status = 'verified'
      AND v.entry_date >= ?
      AND v.entry_date < ?
      AND a.type IN ('revenue', 'expense')
    GROUP BY strftime('%Y-%m', v.entry_date)
    ORDER BY month
  `).bind(tenantId, startDate, endExclusive).all<{ month: string; income: number; expense: number }>();

  return (rows.results ?? []).map((row) => {
    const income = roundMoney(row.income);
    const expense = roundMoney(row.expense);
    return { month: row.month, income, expense, profit: roundMoney(income - expense) };
  });
}
