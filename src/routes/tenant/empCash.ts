import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { requireRole } from '../../middleware/rbac';
import { getTodayGMT6 } from '../../lib/date-utils';

const empCashRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const REPORT_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'receptionist'] as const;
const FINANCE_REPORT_ROLES = new Set(['hospital_admin', 'md', 'director', 'accountant']);

empCashRoutes.use('*', requireRole(...REPORT_ROLES));

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function parseOptionalPositiveInt(value: string | undefined, field: string): number | null | { error: string } {
  if (value === undefined || value === '') return null;
  if (!/^\d+$/.test(value)) return { error: `${field} must be a positive integer` };
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { error: `${field} must be a positive integer` };
  return parsed;
}

function resolveEmployeeFilter(
  role: string | undefined,
  userIdValue: string | undefined,
  requestedEmployeeId: number | null,
): { employeeId: number | null } | { error: string } {
  if (FINANCE_REPORT_ROLES.has(role ?? '')) return { employeeId: requestedEmployeeId };

  const currentUserId = Number(userIdValue);
  if (!Number.isSafeInteger(currentUserId) || currentUserId <= 0) {
    return { error: 'Authenticated employee context is required for cash reports' };
  }
  if (requestedEmployeeId !== null && requestedEmployeeId !== currentUserId) {
    return { error: 'Receptionists can only view their own cash report' };
  }
  return { employeeId: currentUserId };
}

// ─── GET / — list transactions ───────────────────────────────────────────────

empCashRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { employee_id, date, transaction_type } = c.req.query();
  const { page, limit, offset } = getPagination(c);
  if (date && !isValidIsoDate(date)) {
    return c.json({ error: 'Please provide a valid date in YYYY-MM-DD format' }, 400);
  }

  const requestedEmployeeId = parseOptionalPositiveInt(employee_id, 'employee_id');
  if (requestedEmployeeId && typeof requestedEmployeeId === 'object') {
    return c.json({ error: requestedEmployeeId.error }, 400);
  }
  const employeeScope = resolveEmployeeFilter(c.get('role'), c.get('userId'), requestedEmployeeId);
  if ('error' in employeeScope) return c.json({ error: employeeScope.error }, 403);

  let sql = `
    SELECT ect.*, u.name as employee_name
    FROM emp_cash_transactions ect
    LEFT JOIN users u ON ect.employee_id = u.id
    WHERE ect.tenant_id = ?
  `;
  const params: (string | number | null)[] = [tenantId];

  if (employeeScope.employeeId !== null) {
    sql += ' AND ect.employee_id = ?';
    params.push(employeeScope.employeeId);
  }
  if (date) {
    sql += ' AND date(ect.transaction_date) = ?';
    params.push(date);
  }
  if (transaction_type) {
    sql += ' AND ect.transaction_type = ?';
    params.push(transaction_type);
  }

  sql += ' ORDER BY ect.transaction_date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  let countSql = 'SELECT COUNT(*) as total FROM emp_cash_transactions WHERE tenant_id = ?';
  const countParams: (string | number | null)[] = [tenantId];
  if (employeeScope.employeeId !== null) {
    countSql += ' AND employee_id = ?';
    countParams.push(employeeScope.employeeId);
  }
  if (date) {
    countSql += ' AND date(transaction_date) = ?';
    countParams.push(date);
  }
  if (transaction_type) {
    countSql += ' AND transaction_type = ?';
    countParams.push(transaction_type);
  }

  const countResult = await db.$client.prepare(countSql).bind(...countParams).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return c.json({ transactions: results, meta: paginationMeta(page, limit, total) });
});

// ─── GET /summary — daily summary per employee ───────────────────────────────

empCashRoutes.get('/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { date } = c.req.query();
  const targetDate = date || getTodayGMT6();

  if (!isValidIsoDate(targetDate)) {
    return c.json({ error: 'Please provide a valid date in YYYY-MM-DD format' }, 400);
  }

  const employeeScope = resolveEmployeeFilter(c.get('role'), c.get('userId'), null);
  if ('error' in employeeScope) return c.json({ error: employeeScope.error }, 403);

  const employeeWhere = employeeScope.employeeId !== null ? ' AND ect.employee_id = ?' : '';
  const params: (string | number)[] = [tenantId, targetDate];
  if (employeeScope.employeeId !== null) params.push(employeeScope.employeeId);

  const { results } = await db.$client.prepare(`
    SELECT
      ect.employee_id,
      u.name as employee_name,
      COALESCE(SUM(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN ect.amount ELSE 0 END), 0) as total_in,
      COALESCE(SUM(CASE WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN ect.amount ELSE 0 END), 0) as total_out,
      COALESCE(SUM(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN ect.amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN ect.amount ELSE 0 END), 0) as net
    FROM emp_cash_transactions ect
    LEFT JOIN users u ON ect.employee_id = u.id
    WHERE ect.tenant_id = ? AND date(ect.transaction_date) = ?${employeeWhere}
    GROUP BY ect.employee_id
    ORDER BY net DESC
  `).bind(...params).all();

  return c.json({ date: targetDate, summary: results });
});

// ─── GET /performance — operator performance metrics ──────────────────────────

empCashRoutes.get('/performance', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { date, days } = c.req.query();
  const reportDate = date || getTodayGMT6();
  const periodDays = parseInt(days || '30');

  if (!isValidIsoDate(reportDate)) {
    return c.json({ error: 'Please provide a valid date in YYYY-MM-DD format' }, 400);
  }

  const startDate = new Date(reportDate);
  startDate.setDate(startDate.getDate() - periodDays);
  const startDateStr = startDate.toISOString().split('T')[0];

  const performance = await db.$client.prepare(`
    SELECT
      u.id as employee_id,
      u.name as operator_name,
      COUNT(DISTINCT s.id) as total_shifts,
      SUM(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN 1 ELSE 0 END) as sale_count,
      SUM(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN ect.amount ELSE 0 END) as total_collected,
      SUM(CASE WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit') THEN 1 ELSE 0 END) as return_count,
      SUM(CASE WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit') THEN ect.amount ELSE 0 END) as total_returned,
      AVG(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN ect.amount END) as avg_transaction_value
    FROM users u
    LEFT JOIN billing_counter_sessions s
      ON s.employee_id = u.id
      AND s.tenant_id = u.tenant_id
      AND date(s.opened_at) >= ?
    LEFT JOIN emp_cash_transactions ect
      ON ect.employee_id = u.id
      AND ect.tenant_id = u.tenant_id
      AND date(ect.transaction_date) >= ?
    WHERE u.tenant_id = ?
      AND u.role IN ('reception', 'receptionist', 'accountant')
    GROUP BY u.id, u.name
    HAVING total_shifts > 0
    ORDER BY total_collected DESC
  `).bind(startDateStr, startDateStr, tenantId).all();

  return c.json({
    period: { startDate: startDateStr, endDate: reportDate, days: periodDays },
    operators: (performance.results || []).map((row: any) => ({
      employeeId: row.employee_id,
      operatorName: row.operator_name,
      totalShifts: Number(row.total_shifts),
      saleCount: Number(row.sale_count),
      totalCollected: Number(row.total_collected ?? 0),
      returnCount: Number(row.return_count),
      totalReturned: Number(row.total_returned ?? 0),
      avgTransactionValue: Number(row.avg_transaction_value ?? 0),
      returnRate: Number(row.sale_count) > 0
        ? ((Number(row.return_count) / Number(row.sale_count)) * 100).toFixed(2)
        : '0.00',
      netCollection: Number(row.total_collected ?? 0) - Number(row.total_returned ?? 0),
    })),
  });
});

// ─── GET /employee/:employeeId ──────────────────────────────────────────────

empCashRoutes.get('/employee/:employeeId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const employeeId = parseInt(c.req.param('employeeId'));
  if (isNaN(employeeId) || employeeId <= 0) {
    throw new HTTPException(400, { message: 'Invalid employee ID' });
  }

  const { date, transaction_type } = c.req.query();
  const { page, limit, offset } = getPagination(c);
  if (date && !isValidIsoDate(date)) {
    return c.json({ error: 'Please provide a valid date in YYYY-MM-DD format' }, 400);
  }

  const employeeScope = resolveEmployeeFilter(c.get('role'), c.get('userId'), employeeId);
  if ('error' in employeeScope) return c.json({ error: employeeScope.error }, 403);

  let sql = `
    SELECT ect.*, u.name as employee_name
    FROM emp_cash_transactions ect
    LEFT JOIN users u ON ect.employee_id = u.id
    WHERE ect.tenant_id = ? AND ect.employee_id = ?
  `;
  const params: (string | number | null)[] = [tenantId, employeeId];

  if (date) {
    sql += ' AND date(ect.transaction_date) = ?';
    params.push(date);
  }
  if (transaction_type) {
    sql += ' AND ect.transaction_type = ?';
    params.push(transaction_type);
  }

  sql += ' ORDER BY ect.transaction_date DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  let countSql = 'SELECT COUNT(*) as total FROM emp_cash_transactions WHERE tenant_id = ? AND employee_id = ?';
  const countParams: (string | number | null)[] = [tenantId, employeeId];
  if (date) {
    countSql += ' AND date(transaction_date) = ?';
    countParams.push(date);
  }
  if (transaction_type) {
    countSql += ' AND transaction_type = ?';
    countParams.push(transaction_type);
  }

  const countResult = await db.$client.prepare(countSql).bind(...countParams).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  return c.json({ transactions: results, meta: paginationMeta(page, limit, total) });
});

export default empCashRoutes;
