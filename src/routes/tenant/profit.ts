import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { distributeProfitSchema } from '../../schemas/accounting';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import { requireRole } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';
import { ACCOUNTING_EVENT_TYPES, recordAndPostAccountingEvent } from '../../lib/accounting-posting';
import { getGlIncomeExpenseTotals } from '../../lib/accounting-reporting';


const profitRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function monthEndDate(targetMonth: string): string {
  const [year, month] = targetMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
}

profitRoutes.get('/calculate', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { month } = c.req.query();

  const targetMonth = month || getTodayGMT6().substring(0, 7);
  const monthStart = `${targetMonth}-01`;
  const monthEnd = monthEndDate(targetMonth);

  try {
    const financialTotals = await getGlIncomeExpenseTotals(c.env.DB, tenantId, monthStart, monthEnd);
    const settingsResult = await db.$client.prepare(`
      SELECT value FROM settings WHERE key = 'profit_percentage' AND tenant_id = ?
    `).bind(tenantId).first<{ value: string }>();

    const totalIncome = financialTotals.income;
    const totalExpense = financialTotals.expense;
    const totalProfit = financialTotals.profit;
    const profitPercentage = parseFloat(settingsResult?.value || '30');
    const distributableProfit = totalProfit > 0 ? totalProfit * (profitPercentage / 100) : 0;

    return c.json({
      month: targetMonth,
      totalIncome,
      totalExpense,
      totalProfit,
      profitPercentage,
      distributableProfit,
      calculatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error calculating profit:', error);
    return c.json({ error: 'Failed to calculate profit' }, 500);
  }
});

profitRoutes.post('/distribute', requireRole('hospital_admin', 'director'), zValidator('json', distributeProfitSchema), async () => {
  throw new HTTPException(409, {
    message: 'Legacy profit distribution is disabled. Use /api/shareholders/distribute so shareholder payout rows, withholding, and accounting vouchers stay in sync.',
  });
});

profitRoutes.get('/history', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const result = await db.$client.prepare(`
      SELECT pd.*, u.name as approved_by_name
      FROM profit_distributions pd
      LEFT JOIN users u ON pd.approved_by = u.id
      WHERE pd.tenant_id = ?
      ORDER BY pd.month DESC
    `).bind(tenantId).all();

    return c.json({ distributions: result.results });
  } catch (error) {
    console.error('Error fetching profit history:', error);
    return c.json({ error: 'Failed to fetch profit history' }, 500);
  }
});

export default profitRoutes;
