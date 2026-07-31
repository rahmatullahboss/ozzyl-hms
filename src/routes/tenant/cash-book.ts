import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { requireRole } from '../../middleware/rbac';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createAuditLog } from '../../lib/accounting-helpers';
import { cashReconciliationSchema } from '../../schemas/cash-monitoring';
import type { Env, Variables } from '../../types';
import { getTodayGMT6 } from '../../lib/date-utils';

const cashBook = new Hono<{ Bindings: Env; Variables: Variables }>();

cashBook.use('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));

function aggValue(row: Record<string, unknown> | null | undefined): number {
  if (!row) return 0;
  return Number(row.total ?? row.amount ?? 0);
}

function localReportDate(expression: string): string {
  return `date(${expression}, '+6 hours')`;
}

async function loadDailyCashSummary(db: D1Database, tenantId: string, date: string) {
  const collections = await db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND payment_method = ?
        AND transaction_type IN (?, ?, ?)
        AND ${localReportDate('transaction_date')} = date(?)
    `)
    .bind(tenantId, 'cash', 'CashSales', 'CollectionFromReceivable', 'CashDiscountReceived', date)
    .first<Record<string, unknown>>();

  // Direct approved expenses that did not already create a drawer cash_out
  // movement. Drawer-linked expenses are counted through manualCashOut below
  // to avoid double-counting reception cash expenses.
  const expenses = await db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses e
      WHERE e.tenant_id = ?
        AND COALESCE(e.approval_status, e.status) = ?
        AND COALESCE(e.payment_status, 'paid') = 'paid'
        AND date(e.date) = date(?)
        AND NOT EXISTS (
          SELECT 1
          FROM cash_drawer_movements m
          WHERE m.tenant_id = e.tenant_id
            AND m.reference_type IN ('expense', 'expense_pending')
            AND CAST(m.reference_id AS TEXT) = CAST(e.id AS TEXT)
            AND m.movement_type = 'cash_out'
        )
    `)
    .bind(tenantId, 'approved', date)
    .first<Record<string, unknown>>();

  const refunds = await db
    .prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND payment_method = ?
        AND transaction_type IN (?, ?, ?)
        AND ${localReportDate('transaction_date')} = date(?)
    `)
    .bind(tenantId, 'cash', 'SalesReturn', 'ReturnDeposit', 'CashDiscountGiven', date)
    .first<Record<string, unknown>>();

  const drawerMovements = await db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN movement_type = 'cash_in' THEN amount ELSE 0 END), 0) as manual_cash_in,
        COALESCE(SUM(CASE WHEN movement_type = 'cash_out' THEN amount ELSE 0 END), 0) as manual_cash_out,
        COALESCE(SUM(CASE WHEN movement_type = 'cash_drop' THEN amount ELSE 0 END), 0) as cash_drop_total,
        COALESCE(SUM(CASE WHEN movement_type = 'handover' THEN amount ELSE 0 END), 0) as handover_total
      FROM cash_drawer_movements
      WHERE tenant_id = ?
        AND ${localReportDate('created_at')} = date(?)
    `)
    .bind(tenantId, date)
    .first<Record<string, unknown>>();

  const cashCollection = aggValue(collections);
  const cashExpense = aggValue(expenses);
  const cashRefund = aggValue(refunds);
  const manualCashIn = Number(drawerMovements?.manual_cash_in ?? 0);
  const manualCashOut = Number(drawerMovements?.manual_cash_out ?? 0);
  const cashDrop = Number(drawerMovements?.cash_drop_total ?? 0);
  const handoverCash = Number(drawerMovements?.handover_total ?? 0);

  return {
    date,
    openingCash: 0,
    cashCollection,
    cashExpense,
    cashRefund,
    manualCashIn,
    manualCashOut,
    cashDrop,
    handoverCash,
    closingCash: cashCollection - cashExpense - cashRefund + manualCashIn - manualCashOut - cashDrop - handoverCash,
  };
}

cashBook.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || getTodayGMT6();
  return c.json({ data: await loadDailyCashSummary(db, tenantId, date) });
});

cashBook.get('/transactions', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || getTodayGMT6();

  const collections = await db
    .prepare(`
      SELECT *, datetime(transaction_date, '+6 hours') AS transaction_date
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND payment_method = ?
        AND transaction_type IN (?, ?, ?)
        AND ${localReportDate('transaction_date')} = date(?)
      ORDER BY datetime(transaction_date, '+6 hours')
      LIMIT 500
    `)
    .bind(tenantId, 'cash', 'CashSales', 'CollectionFromReceivable', 'CashDiscountReceived', date)
    .all();

  const expenses = await db
    .prepare(`
      SELECT e.*
      FROM expenses e
      WHERE e.tenant_id = ?
        AND COALESCE(e.approval_status, e.status) = ?
        AND COALESCE(e.payment_status, 'paid') = 'paid'
        AND date(e.date) = date(?)
        AND NOT EXISTS (
          SELECT 1
          FROM cash_drawer_movements m
          WHERE m.tenant_id = e.tenant_id
            AND m.reference_type IN ('expense', 'expense_pending')
            AND CAST(m.reference_id AS TEXT) = CAST(e.id AS TEXT)
            AND m.movement_type = 'cash_out'
        )
      ORDER BY e.created_at
      LIMIT 500
    `)
    .bind(tenantId, 'approved', date)
    .all();

  const refunds = await db
    .prepare(`
      SELECT *, datetime(transaction_date, '+6 hours') AS transaction_date
      FROM emp_cash_transactions
      WHERE tenant_id = ?
        AND payment_method = ?
        AND transaction_type IN (?, ?, ?)
        AND ${localReportDate('transaction_date')} = date(?)
      ORDER BY datetime(transaction_date, '+6 hours')
      LIMIT 500
    `)
    .bind(tenantId, 'cash', 'SalesReturn', 'ReturnDeposit', 'CashDiscountGiven', date)
    .all();

  const manualMovements = await db
    .prepare(`
      SELECT
        m.id,
        m.movement_type,
        m.amount,
        m.description,
        m.created_at,
        m.reference_type,
        m.reference_id,
        c.counter_name,
        operator_user.name AS operator_name,
        e.receipt_key
      FROM cash_drawer_movements m
      LEFT JOIN billing_counters c ON c.id = m.counter_id AND c.tenant_id = m.tenant_id
      LEFT JOIN users operator_user ON operator_user.id = m.employee_id AND operator_user.tenant_id = m.tenant_id
      LEFT JOIN expenses e
        ON e.tenant_id = m.tenant_id
       AND CAST(e.id AS TEXT) = CAST(m.reference_id AS TEXT)
       AND m.reference_type IN ('expense', 'expense_pending')
      WHERE m.tenant_id = ?
        AND ${localReportDate('m.created_at')} = date(?)
        AND m.movement_type IN ('cash_in', 'cash_out', 'handover', 'cash_drop')
      ORDER BY m.created_at DESC
      LIMIT 500
    `)
    .bind(tenantId, date)
    .all<Record<string, unknown>>();

  return c.json({
    data: {
      date,
      collections: collections.results,
      expenses: expenses.results,
      refunds: refunds.results,
      manualMovements: (manualMovements.results ?? []).map((row) => ({
        id: Number(row.id),
        movementType: String(row.movement_type ?? ''),
        amount: Number(row.amount ?? 0),
        reason: String(row.description ?? row.reference_type ?? row.movement_type ?? ''),
        createdAt: String(row.created_at ?? ''),
        counterName: row.counter_name ? String(row.counter_name) : null,
        operatorName: row.operator_name ? String(row.operator_name) : null,
        referenceType: row.reference_type ? String(row.reference_type) : null,
        referenceId: row.reference_id ? String(row.reference_id) : null,
        receiptAvailable: Boolean(row.receipt_key),
      })),
    },
  });
});

// POST /reconcile — cash reconciliation
cashBook.post('/reconcile', zValidator('json', cashReconciliationSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = c.env.DB;
  const { date, actualCash, notes } = c.req.valid('json');

  // Use the same canonical daily cash formula as the summary endpoint, so
  // reconciliation includes manual cash in/out, cash drops, handovers, refunds,
  // and drawer-linked expenses consistently.
  const summary = await loadDailyCashSummary(db, tenantId, date);
  const expectedCash = summary.closingCash;
  const variance = actualCash - expectedCash;

  // Store reconciliation record
  await db.prepare(`
    INSERT INTO cash_reconciliations (tenant_id, reconciliation_date, expected_cash, actual_cash, variance, notes, reconciled_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, date, expectedCash, actualCash, variance, notes || null, userId).run();

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'cash_reconciliations', 0, null, {
    date,
    expectedCash,
    actualCash,
    variance,
    components: summary,
  });

  return c.json({
    date,
    expectedCash,
    actualCash,
    variance,
    status: variance === 0 ? 'matched' : variance > 0 ? 'overage' : 'shortage',
    components: summary,
  });
});

// GET /reconciliations — list reconciliation history
cashBook.get('/reconciliations', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const { startDate, endDate } = c.req.query();

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (startDate && !dateOnly.test(startDate)) {
    return c.json({ error: 'startDate must be YYYY-MM-DD' }, 400);
  }
  if (endDate && !dateOnly.test(endDate)) {
    return c.json({ error: 'endDate must be YYYY-MM-DD' }, 400);
  }

  let sql = `SELECT r.*, u.name as reconciled_by_name FROM cash_reconciliations r LEFT JOIN users u ON u.id = r.reconciled_by WHERE r.tenant_id = ?`;
  const params: any[] = [tenantId];

  if (startDate) {
    sql += ` AND r.reconciliation_date >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND r.reconciliation_date <= ?`;
    params.push(endDate);
  }

  sql += ` ORDER BY r.reconciliation_date DESC LIMIT 100`;

  const results = await db.prepare(sql).bind(...params).all();
  return c.json({ reconciliations: results.results });
});

export default cashBook;
