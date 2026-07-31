import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import type { Env, Variables } from '../../types';
import { requireRole } from '../../middleware/rbac';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  getBillingWorkstationId,
  loadActiveBillingCounterSession,
} from '../../lib/billing-counter-session';
import { cashOperationSettingsPatchSchema } from '../../schemas/cash-operations';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
const READ_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist', 'manager'] as const;
const ADMIN_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

type DateRange = { from?: string; to?: string };
type CounterSessionRow = {
  id: number;
  counter_id: number;
  counter_name?: string | null;
  opening_cash?: number | null;
  opened_at?: string | null;
  closed_at?: string | null;
  status?: string | null;
  employee_id?: number | string | null;
  operator_name?: string | null;
};

type ActiveOverviewTotals = {
  patientCashCollection: number;
  refundCashOut: number;
  doctorPayout: number;
  expenseCashOut: number;
  transferOut: number;
  acceptedTransferIn: number;
  bankDepositCustody: number;
  openingCash: number;
  manualCashIn: number;
  manualCashOut: number;
  cashDrop: number;
  otherDrawerCashOut: number;
  currentDrawerBalance: number;
};

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

const RECEIPT_NO_PATTERN = /\bRCP-[A-Za-z0-9-]+\b/g;

function empCashLegacyTimestampSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `datetime(COALESCE(${prefix}transaction_date, ${prefix}created_at), '+6 hours')`;
}

function empCashTimestampSql(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  const legacyTimestamp = empCashLegacyTimestampSql(alias);
  return `CASE
    WHEN ${prefix}reference_type = 'bill' THEN COALESCE((
      SELECT p.date
      FROM payments p
      WHERE p.tenant_id = ${prefix}tenant_id
        AND p.bill_id = CAST(${prefix}reference_id AS INTEGER)
        AND ABS(COALESCE(p.amount, 0) - COALESCE(${prefix}amount, 0)) < 0.01
        AND COALESCE(p.payment_method, 'cash') = COALESCE(${prefix}payment_method, 'cash')
        AND (${prefix}counter_session_id IS NULL OR p.counter_session_id IS NULL OR p.counter_session_id = ${prefix}counter_session_id)
      ORDER BY datetime(COALESCE(p.created_at, p.date)) DESC, p.id DESC
      LIMIT 1
    ), ${legacyTimestamp})
    ELSE ${legacyTimestamp}
  END`;
}

function empCashActivityTimestampSql(): string {
  return empCashTimestampSql('ect');
}

function displayCashActivityDescription(description: string | null, invoiceNo: string | null): string | null {
  if (!description || !invoiceNo) return description;
  return description.replace(RECEIPT_NO_PATTERN, invoiceNo);
}

function isMonitoringRole(role: Variables['role'] | undefined): boolean {
  return role === 'hospital_admin' || role === 'md' || role === 'director' || role === 'accountant';
}

function getDateRange(c: { req: { query: (name: string) => string | undefined } }): DateRange {
  return {
    from: c.req.query('from') || c.req.query('dateFrom') || undefined,
    to: c.req.query('to') || c.req.query('dateTo') || undefined,
  };
}

function sqlDateValueExpression(expression: string): string {
  const trimmed = expression.trim();
  if (/^(?:\w+\s*\(|CASE\b)/i.test(trimmed)) return trimmed;
  return trimmed.includes(',') ? `COALESCE(${trimmed})` : trimmed;
}

function localDateExpression(column: string): string {
  const valueExpr = sqlDateValueExpression(column);
  return `CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN ${valueExpr} LIKE '%Z' OR ${valueExpr} LIKE '%+00:00' OR ${valueExpr} LIKE '%-00:00'
      THEN date(${valueExpr}, '+6 hours')
    ELSE date(${valueExpr})
  END`;
}

function appendDateFilter(sql: string, params: Array<string | number>, column: string, range: DateRange): string {
  let nextSql = sql;
  const dateExpr = localDateExpression(column);
  if (range.from) {
    nextSql += ` AND ${dateExpr} >= ?`;
    params.push(range.from);
  }
  if (range.to) {
    nextSql += ` AND ${dateExpr} <= ?`;
    params.push(range.to);
  }
  return nextSql;
}


function appendSessionWindow(sql: string, params: Array<string | number>, column: string, session?: CounterSessionRow | null): string {
  let nextSql = sql;
  if (session?.opened_at) {
    nextSql += ` AND datetime(${column}) >= datetime(?)`;
    params.push(String(session.opened_at));
  }
  if (session?.closed_at) {
    nextSql += ` AND datetime(${column}) <= datetime(?)`;
    params.push(String(session.closed_at));
  }
  return nextSql;
}

async function activeSessionOrThrow(c: { env: Env; req: { header: (name: string) => string | undefined }; get: (key: 'role') => Variables['role'] | undefined }, tenantId: string, userId: string) {
  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
    allowPendingVarianceApproval: isMonitoringRole(c.get('role')),
  });
  if (!session) throw new HTTPException(404, { message: 'Active counter session not found' });
  return session as CounterSessionRow;
}

async function resolveReadSession(
  c: { env: Env; req: { header: (name: string) => string | undefined; query: (name: string) => string | undefined }; get: (key: 'role') => Variables['role'] | undefined },
  tenantId: string,
  userId: string,
): Promise<CounterSessionRow> {
  const requestedSessionId = Number(c.req.query('counterSessionId') ?? 0);
  const requestedCounterId = Number(c.req.query('counterId') ?? 0);
  const canMonitor = isMonitoringRole(c.get('role'));

  if (Number.isInteger(requestedSessionId) && requestedSessionId > 0) {
    const ownershipClause = canMonitor ? '' : 'AND s.employee_id = ?';
    const sessionParams = canMonitor ? [tenantId, requestedSessionId] : [tenantId, requestedSessionId, userId];
    const session = await c.env.DB.prepare(`
      SELECT s.*, bc.counter_name AS counter_name
      FROM billing_counter_sessions s
      LEFT JOIN billing_counters bc ON bc.tenant_id = s.tenant_id AND bc.id = s.counter_id
      WHERE s.tenant_id = ? AND s.id = ?
        ${ownershipClause}
      LIMIT 1
    `).bind(...sessionParams).first<CounterSessionRow>();
    if (!session) throw new HTTPException(404, { message: 'Counter session not found' });
    return session;
  }

  if (canMonitor && Number.isInteger(requestedCounterId) && requestedCounterId > 0) {
    const session = await c.env.DB.prepare(`
      SELECT s.*, bc.counter_name AS counter_name
      FROM billing_counter_sessions s
      LEFT JOIN billing_counters bc ON bc.tenant_id = s.tenant_id AND bc.id = s.counter_id
      WHERE s.tenant_id = ? AND s.counter_id = ?
      ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.opened_at DESC, s.id DESC
      LIMIT 1
    `).bind(tenantId, requestedCounterId).first<CounterSessionRow>();
    if (!session) throw new HTTPException(404, { message: 'Counter session not found' });
    return session;
  }

  return activeSessionOrThrow(c, tenantId, userId);
}

async function sumEmpCash(db: D1Database, tenantId: string, session: CounterSessionRow, types: string[], range: DateRange): Promise<number> {
  const placeholders = types.map(() => '?').join(',');
  const params: Array<string | number> = [tenantId, Number(session.id), ...types];
  let sql = appendDateFilter(`
    SELECT COALESCE(SUM(ect.amount), 0) AS total
    FROM emp_cash_transactions ect
    WHERE ect.tenant_id = ?
      AND ect.counter_session_id = ?
      AND COALESCE(ect.payment_method, 'cash') = 'cash'
      AND ect.transaction_type IN (${placeholders})
  `, params, empCashTimestampSql('ect'), range);
  sql = appendSessionWindow(sql, params, empCashTimestampSql('ect'), session);
  const row = await db.prepare(sql).bind(...params).first<{ total: number }>();
  return money(row?.total ?? (row as { amount?: number } | null)?.amount);
}

async function sumMovement(db: D1Database, tenantId: string, session: CounterSessionRow, movementType: string, referenceTypes: string[], range: DateRange): Promise<number> {
  const placeholders = referenceTypes.map(() => '?').join(',');
  const params: Array<string | number> = [tenantId, Number(session.id), movementType, ...referenceTypes];
  let sql = appendDateFilter(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM cash_drawer_movements
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND movement_type = ?
      AND reference_type IN (${placeholders})
  `, params, 'created_at', range);
  sql = appendSessionWindow(sql, params, 'created_at', session);
  const row = await db.prepare(sql).bind(...params).first<{ total: number }>();
  return money(row?.total ?? (row as { amount?: number } | null)?.amount);
}

async function sumMovementType(db: D1Database, tenantId: string, session: CounterSessionRow, movementType: string, range: DateRange): Promise<number> {
  const params: Array<string | number> = [tenantId, Number(session.id), movementType];
  let sql = appendDateFilter(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM cash_drawer_movements
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND movement_type = ?
  `, params, 'created_at', range);
  sql = appendSessionWindow(sql, params, 'created_at', session);
  const row = await db.prepare(sql).bind(...params).first<{ total: number }>();
  return money(row?.total ?? (row as { amount?: number } | null)?.amount);
}

function computeActiveOverviewTotals(input: Omit<ActiveOverviewTotals, 'currentDrawerBalance' | 'otherDrawerCashOut'>): ActiveOverviewTotals {
  const openingCash = money(input.openingCash);
  const patientCashCollection = money(input.patientCashCollection);
  const refundCashOut = money(input.refundCashOut);
  const doctorPayout = money(input.doctorPayout);
  const expenseCashOut = money(input.expenseCashOut);
  const transferOut = money(input.transferOut);
  const acceptedTransferIn = money(input.acceptedTransferIn);
  const bankDepositCustody = money(input.bankDepositCustody);
  const manualCashIn = money(input.manualCashIn);
  const manualCashOut = money(input.manualCashOut);
  const cashDrop = money(input.cashDrop);
  const otherDrawerCashOut = money(Math.max(0, manualCashOut - doctorPayout - expenseCashOut));

  return {
    openingCash,
    patientCashCollection,
    refundCashOut,
    doctorPayout,
    expenseCashOut,
    transferOut,
    acceptedTransferIn,
    bankDepositCustody,
    manualCashIn,
    manualCashOut,
    cashDrop,
    otherDrawerCashOut,
    currentDrawerBalance: money(
      openingCash
      + patientCashCollection
      + manualCashIn
      - refundCashOut
      - manualCashOut
      - cashDrop,
    ),
  };
}

routes.get('/overview', requireRole(...READ_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const session = await resolveReadSession(c, tenantId, userId);
  const range = getDateRange(c);

  const [
    patientCashCollection,
    refundCashOut,
    doctorPayout,
    expenseCashOut,
    transferOut,
    acceptedTransferIn,
    bankDepositCustody,
    manualCashIn,
    manualCashOut,
    cashDrop,
  ] = await Promise.all([
    sumEmpCash(c.env.DB, tenantId, session, ['CashSales', 'CollectionFromReceivable', 'CashDiscountReceived'], range),
    sumEmpCash(c.env.DB, tenantId, session, ['SalesReturn', 'ReturnDeposit', 'CashDiscountGiven'], range),
    sumMovement(c.env.DB, tenantId, session, 'cash_out', ['doctor_commission_settlement', 'doctor_payout'], range),
    sumMovement(c.env.DB, tenantId, session, 'cash_out', ['expense', 'petty_cash_expense'], range),
    sumMovement(c.env.DB, tenantId, session, 'cash_drop', ['cash_transfer', 'counter_cash_transfer', 'billing_counter_cash_transfer', 'cash_custody_transfer'], range),
    sumMovement(c.env.DB, tenantId, session, 'cash_in', ['accepted_cash_transfer', 'cash_transfer_acceptance', 'counter_handover'], range),
    sumMovement(c.env.DB, tenantId, session, 'cash_drop', ['bank_deposit', 'bank_deposit_request'], range),
    sumMovementType(c.env.DB, tenantId, session, 'cash_in', range),
    sumMovementType(c.env.DB, tenantId, session, 'cash_out', range),
    sumMovementType(c.env.DB, tenantId, session, 'cash_drop', range),
  ]);

  const totals = computeActiveOverviewTotals({
    openingCash: money(session.opening_cash),
    patientCashCollection,
    refundCashOut,
    doctorPayout,
    expenseCashOut,
    transferOut,
    acceptedTransferIn,
    bankDepositCustody,
    manualCashIn,
    manualCashOut,
    cashDrop,
  });
  const heldRefundRow = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM billing_refund_cash_holds
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND status = 'held'
  `).bind(tenantId, Number(session.id)).first<{ amount?: number | null }>();
  const heldRefundCash = money(heldRefundRow?.amount ?? 0);
  const availableCash = money(totals.currentDrawerBalance - heldRefundCash);

  return c.json({
    overview: {
      sessionId: session.id,
      counterId: session.counter_id,
      counterName: session.counter_name,
      sessionStatus: session.status ?? null,
      openedAt: session.opened_at ?? null,
      closedAt: session.closed_at ?? null,
      openingCash: totals.openingCash,
      patientCashCollection: totals.patientCashCollection,
      refundCashOut: totals.refundCashOut,
      doctorPayout: totals.doctorPayout,
      expenseCashOut: totals.expenseCashOut,
      transferOut: totals.transferOut,
      acceptedTransferIn: totals.acceptedTransferIn,
      bankDepositCustody: totals.bankDepositCustody,
      cashIn: totals.patientCashCollection,
      cashOut: totals.refundCashOut,
      manualCashIn: totals.manualCashIn,
      manualCashOut: totals.manualCashOut,
      otherDrawerCashOut: totals.otherDrawerCashOut,
      cashDrop: totals.cashDrop,
      currentDrawerBalance: totals.currentDrawerBalance,
      heldRefundCash,
      availableCash,
      balanceSource: 'cash_operations_drawer_ledger',
      balanceFormula: 'opening + patientCash + allDrawerCashIn - refunds - allDrawerCashOut - allCashDrop',
      balanceComponents: totals,
      dateFrom: range.from ?? null,
      dateTo: range.to ?? null,
    },
  });
});

routes.get('/activity', requireRole(...READ_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const range = getDateRange(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200) || 200, 1), 2000);
  const reportScope = String(c.req.query('report') ?? c.req.query('scope') ?? '').toLowerCase();
  const allSessions = isMonitoringRole(c.get('role')) && (reportScope === 'all' || c.req.query('allSessions') === '1');
  const session = allSessions ? null : await resolveReadSession(c, tenantId, userId);

  const movementParams: Array<string | number> = allSessions ? [tenantId] : [tenantId, Number(session?.id)];
  let movementSql = appendDateFilter(`
    SELECT
      'movement' AS source,
      m.id,
      m.created_at,
      m.employee_id,
      u.name AS actor_name,
      m.movement_type,
      m.reference_type,
      m.reference_id,
      m.amount,
      m.description,
      t.transfer_no,
      t.status AS transfer_status,
      sender.name AS transfer_by_name,
      receiver.name AS transfer_to_name,
      t.destination_type,
      t.custody_label,
      t.received_amount,
      t.due_amount,
      t.received_at,
      NULL AS invoice_no
    FROM cash_drawer_movements m
    LEFT JOIN users u ON u.id = m.employee_id AND u.tenant_id = m.tenant_id
    LEFT JOIN billing_counter_cash_transfers t
      ON t.tenant_id = m.tenant_id
      AND t.id = CAST(m.reference_id AS INTEGER)
      AND m.reference_type = 'cash_custody_transfer'
    LEFT JOIN users sender ON sender.id = t.transfer_by AND sender.tenant_id = t.tenant_id
    LEFT JOIN users receiver ON receiver.id = t.transfer_to AND receiver.tenant_id = t.tenant_id
    WHERE m.tenant_id = ?
      ${allSessions ? '' : 'AND m.counter_session_id = ?'}
  `, movementParams, 'm.created_at', range);
  if (!allSessions) movementSql = appendSessionWindow(movementSql, movementParams, 'm.created_at', session);

  const transactionCreatedAtSql = empCashActivityTimestampSql();
  const transactionParams: Array<string | number> = allSessions ? [tenantId] : [tenantId, Number(session?.id)];
  let transactionSql = appendDateFilter(`
    SELECT
      'transaction' AS source,
      ect.id,
      ${transactionCreatedAtSql} AS created_at,
      ect.employee_id,
      u.name AS actor_name,
      CASE
        WHEN ect.transaction_type IN ('CashSales','CollectionFromReceivable','CashDiscountReceived') THEN 'cash_in'
        ELSE 'cash_out'
      END AS movement_type,
      ect.reference_type,
      ect.reference_id,
      ect.amount,
      COALESCE(ect.description, ect.transaction_type) AS description,
      NULL AS transfer_no,
      NULL AS transfer_status,
      NULL AS transfer_by_name,
      NULL AS transfer_to_name,
      NULL AS destination_type,
      NULL AS custody_label,
      NULL AS received_amount,
      NULL AS due_amount,
      NULL AS received_at,
      b.invoice_no
    FROM emp_cash_transactions ect
    LEFT JOIN users u ON u.id = ect.employee_id AND u.tenant_id = ect.tenant_id
    LEFT JOIN bills b
      ON b.tenant_id = ect.tenant_id
      AND ect.reference_type = 'bill'
      AND b.id = CAST(ect.reference_id AS INTEGER)
    WHERE ect.tenant_id = ?
      ${allSessions ? '' : 'AND ect.counter_session_id = ?'}
      AND COALESCE(ect.payment_method, 'cash') = 'cash'
  `, transactionParams, transactionCreatedAtSql, range);
  if (!allSessions) transactionSql = appendSessionWindow(transactionSql, transactionParams, transactionCreatedAtSql, session);

  const openingParams: Array<string | number> = allSessions ? [tenantId] : [tenantId, Number(session?.id)];
  const openingSql = appendDateFilter(`
    SELECT
      'counter_session' AS source,
      s.id,
      COALESCE(s.opened_at, s.created_at) AS created_at,
      s.employee_id,
      u.name AS actor_name,
      'opening' AS movement_type,
      'counter_opening' AS reference_type,
      s.id AS reference_id,
      COALESCE(s.opening_cash, 0) AS amount,
      COALESCE(bc.counter_name, 'Counter') || ' opening cash' AS description,
      NULL AS transfer_no,
      NULL AS transfer_status,
      NULL AS transfer_by_name,
      NULL AS transfer_to_name,
      NULL AS destination_type,
      NULL AS custody_label,
      NULL AS received_amount,
      NULL AS due_amount,
      NULL AS received_at,
      NULL AS invoice_no
    FROM billing_counter_sessions s
    LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
      ${allSessions ? '' : 'AND s.id = ?'}
  `, openingParams, 'COALESCE(s.opened_at, s.created_at)', range);

  const { results } = await c.env.DB.prepare(`
    SELECT * FROM (
      ${openingSql}
      UNION ALL
      ${movementSql}
      UNION ALL
      ${transactionSql}
    ) activity
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).bind(...openingParams, ...movementParams, ...transactionParams, limit).all<Record<string, unknown>>();

  return c.json({
    activity: (results ?? []).map((row) => {
      const invoiceNo = row.invoice_no ? String(row.invoice_no) : null;
      const transferNo = row.transfer_no ? String(row.transfer_no) : null;
      const referenceNo = invoiceNo ?? transferNo;
      const description = displayCashActivityDescription(row.description ? String(row.description) : null, invoiceNo);
      return {
        id: `${String(row.source ?? 'activity')}-${String(row.id)}`,
        source: row.source ? String(row.source) : 'activity',
        createdAt: String(row.created_at ?? ''),
        actorName: row.actor_name ? String(row.actor_name) : null,
        movementType: String(row.movement_type ?? ''),
        referenceType: String(row.reference_type ?? ''),
        referenceId: row.reference_id == null ? null : Number(row.reference_id),
        referenceNo,
        invoiceNo,
        amount: money(row.amount),
        status: 'posted',
        description,
        transferNo,
        transferStatus: row.transfer_status ? String(row.transfer_status) : null,
        transferByName: row.transfer_by_name ? String(row.transfer_by_name) : null,
        transferToName: row.transfer_to_name ? String(row.transfer_to_name) : null,
        destinationType: row.destination_type ? String(row.destination_type) : null,
        custodyLabel: row.custody_label ? String(row.custody_label) : null,
        receivedAmount: money(row.received_amount),
        dueAmount: money(row.due_amount),
        receivedAt: row.received_at ? String(row.received_at) : null,
      };
    }),
    session: {
      sessionId: allSessions ? null : session!.id,
      counterId: allSessions ? null : session!.counter_id,
      counterName: allSessions ? null : session!.counter_name ?? null,
      dateFrom: range.from ?? null,
      dateTo: range.to ?? null,
    },
  });
});


routes.get('/sessions', requireRole(...READ_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const canMonitor = isMonitoringRole(c.get('role'));
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 30) || 30, 1), 100);
  const requestedCounterId = Number(c.req.query('counterId') ?? 0);
  const range = getDateRange(c);
  const params: Array<string | number> = [tenantId];
  let filterSql = 's.tenant_id = ?';

  if (canMonitor && Number.isInteger(requestedCounterId) && requestedCounterId > 0) {
    filterSql += ' AND s.counter_id = ?';
    params.push(requestedCounterId);
  } else if (!canMonitor) {
    filterSql += ' AND s.employee_id = ?';
    params.push(userId);
  }
  if (range.from) {
    filterSql += ` AND ${localDateExpression('COALESCE(s.closed_at, s.opened_at, s.created_at)')} >= ?`;
    params.push(range.from);
  }
  if (range.to) {
    filterSql += ` AND ${localDateExpression('COALESCE(s.opened_at, s.created_at)')} <= ?`;
    params.push(range.to);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      s.id,
      s.counter_id,
      s.employee_id,
      s.opening_cash,
      s.opened_at,
      s.closed_at,
      s.status,
      bc.counter_name AS counter_name,
      u.name AS operator_name
    FROM billing_counter_sessions s
    LEFT JOIN billing_counters bc ON bc.tenant_id = s.tenant_id AND bc.id = s.counter_id
    LEFT JOIN users u ON u.tenant_id = s.tenant_id AND u.id = s.employee_id
    WHERE ${filterSql}
    ORDER BY datetime(COALESCE(s.closed_at, s.opened_at, s.created_at)) DESC, s.id DESC
    LIMIT ?
  `).bind(...params, limit).all<CounterSessionRow>();

  return c.json({
    sessions: (results ?? []).map((session) => ({
      sessionId: Number(session.id),
      counterId: Number(session.counter_id),
      counterName: session.counter_name ?? null,
      operatorName: session.operator_name ?? null,
      status: session.status ?? null,
      openedAt: session.opened_at ?? null,
      closedAt: session.closed_at ?? null,
      openingCash: money(session.opening_cash),
    })),
  });
});

routes.get('/settings', requireRole(...READ_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const row = await c.env.DB.prepare(`
    SELECT petty_cash_auto_approve_limit, receipt_required_limit
    FROM cash_operation_settings
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first<{ petty_cash_auto_approve_limit?: number; receipt_required_limit?: number }>();

  return c.json({
    settings: {
      pettyCashAutoApproveLimit: money(row?.petty_cash_auto_approve_limit ?? 1000),
      receiptRequiredLimit: money(row?.receipt_required_limit ?? 1000),
    },
  });
});

routes.patch('/settings', requireRole(...ADMIN_ROLES), zValidator('json', cashOperationSettingsPatchSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const current = await c.env.DB.prepare(`
    SELECT petty_cash_auto_approve_limit, receipt_required_limit
    FROM cash_operation_settings
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first<{ petty_cash_auto_approve_limit?: number; receipt_required_limit?: number }>();
  const pettyLimit = money(data.pettyCashAutoApproveLimit ?? current?.petty_cash_auto_approve_limit ?? 1000);
  const receiptLimit = money(data.receiptRequiredLimit ?? current?.receipt_required_limit ?? 1000);

  await c.env.DB.prepare(`
    INSERT INTO cash_operation_settings
      (tenant_id, petty_cash_auto_approve_limit, receipt_required_limit, updated_at)
    VALUES (?, ?, ?, datetime('now', '+6 hours'))
    ON CONFLICT(tenant_id) DO UPDATE SET
      petty_cash_auto_approve_limit = excluded.petty_cash_auto_approve_limit,
      receipt_required_limit = excluded.receipt_required_limit,
      updated_at = datetime('now', '+6 hours')
  `).bind(tenantId, pettyLimit, receiptLimit).run();

  return c.json({
    success: true,
    updatedBy: userId,
    settings: {
      pettyCashAutoApproveLimit: pettyLimit,
      receiptRequiredLimit: receiptLimit,
    },
  });
});

export default routes;
