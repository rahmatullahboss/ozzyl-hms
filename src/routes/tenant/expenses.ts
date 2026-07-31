import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createExpenseSchema, updateExpenseSchema } from '../../schemas/accounting';
import { expenseBudgetSchema } from '../../schemas/cash-monitoring';
import { getDb } from '../../db';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { requirePermission, requireRole } from '../../middleware/rbac';
import type { Env, Variables } from '../../types';
import {
  hasDirectExpenseAccountingEvent,
  recordAndQueueDirectExpenseAccountingEvent,
} from '../../lib/direct-finance-accounting';
import {
  calculateBillingCounterSessionCashSummary,
  getBillingWorkstationId,
  loadActiveBillingCounterSession,
} from '../../lib/billing-counter-session';
import { getUploadObjectForResponse } from '../../lib/upload-objects';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../lib/canonical/source-mapping';
import {
  ApprovalPolicyError,
  recordSourceApprovalDecision,
} from '../../services/approvals/two-person-policy';

const expenseRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
// `manager` is intentionally excluded: it is not a canonical tenant role in shared authz.
const EXPENSE_READ_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const EXPENSE_WRITE_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const EXPENSE_APPROVAL_ROLES = ['hospital_admin', 'md', 'director'] as const;
const EXPENSE_RECEIPT_VERIFY_ROLES = ['hospital_admin', 'md', 'director'] as const;
const EXPENSE_RECEIPT_UPLOAD_PERMISSION = 'expenses.receipts.upload';

const DEFAULT_APPROVAL_THRESHOLD = 1000;
const executeExpenseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
const rejectExpenseSchema = z.object({
  recoveryAction: z.enum(['mark_recovery_required', 'cash_returned']).optional(),
  recoveryNote: z.string().trim().max(500).optional(),
});
const recoverExpenseSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_RECEIPT_STATUSES = new Set(['not_uploaded', 'uploaded', 'verified', 'rejected']);

function safeInt(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function readOptionalJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

async function loadExpense(c: { env: Env }, tenantId: string, id: string) {
  return c.env.DB.prepare(`
    SELECT * FROM expenses WHERE id = ? AND tenant_id = ?
  `).bind(id, tenantId).first<Record<string, unknown>>();
}

async function loadExpenseByIdempotencyKey(c: { env: Env }, tenantId: string, idempotencyKey: string) {
  return c.env.DB.prepare(`
    SELECT *
    FROM expenses
    WHERE tenant_id = ?
      AND execution_idempotency_key = ?
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<Record<string, unknown>>();
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(message);
}

function buildExistingExpenseCreateResponse(expense: Record<string, unknown>) {
  const approvalStatus = String(expense.approval_status ?? expense.status ?? 'approved');
  const paymentStatus = String(expense.payment_status ?? (approvalStatus === 'approved' ? 'paid' : 'unpaid'));
  const approvalRequired = Number(expense.approval_required ?? 0) === 1;
  const approvalThreshold = Number(expense.approval_threshold ?? DEFAULT_APPROVAL_THRESHOLD);

  return {
    success: true,
    duplicate: true,
    id: expense.id,
    status: approvalStatus,
    approvalStatus,
    paymentStatus,
    receiptStatus: expense.receipt_status ?? (expense.receipt_key ? 'uploaded' : 'not_uploaded'),
    expense: {
      id: expense.id,
      date: expense.date,
      category: expense.category,
      amount: Number(expense.amount ?? 0),
      description: expense.description ?? null,
      payeeName: expense.payee_name ?? null,
      status: approvalStatus,
      approvalStatus,
      paymentStatus,
      approvalRequired,
      approvalThreshold: Number.isFinite(approvalThreshold) ? approvalThreshold : DEFAULT_APPROVAL_THRESHOLD,
    },
    message: 'Expense already recorded',
  };
}

function assertValidReceiptStatus(expense: Record<string, unknown>): void {
  const status = expense.receipt_status ?? (expense.receipt_key ? 'uploaded' : 'not_uploaded');
  if (typeof status !== 'string' || !ALLOWED_RECEIPT_STATUSES.has(status)) {
    throw new HTTPException(500, { message: 'Expense has an invalid voucher status' });
  }
}

async function loadExpenseApprovalThreshold(db: D1Database, tenantId: string): Promise<number> {
  const row = await db.prepare(`
    SELECT petty_cash_auto_approve_limit
    FROM cash_operation_settings
    WHERE tenant_id = ?
    LIMIT 1
  `).bind(tenantId).first<{ petty_cash_auto_approve_limit?: number | null }>();
  const threshold = Number(row?.petty_cash_auto_approve_limit ?? DEFAULT_APPROVAL_THRESHOLD);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : DEFAULT_APPROVAL_THRESHOLD;
}

async function shadowWriteExpenseCashOut(params: {
  db: D1Database;
  tenantId: string;
  expenseId: string | number;
  amount: number;
  category?: string | null;
  description?: string | null;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  occurredAt?: string | null;
  businessDate: string;
  idempotencySuffix: string;
}) {
  const occurredAt = params.occurredAt ?? new Date().toISOString();
  const sourcePublicId = `${params.expenseId}:${params.idempotencySuffix}`;
  const [accountingEventPublicId, cashCustodyEventPublicId, sourceEvidenceSha256] = await Promise.all([
    createDeterministicSourceId('acctevt', params.tenantId, 'legacy_expense_paid', sourcePublicId),
    createDeterministicSourceId('cashevt', params.tenantId, 'legacy_expense_cash', sourcePublicId),
    createSourceEvidenceSha256({
      sourceType: 'legacy_expense_paid',
      sourcePublicId,
      amountMinor: Math.round(params.amount * 100),
      businessDate: params.businessDate,
      paymentMethod: 'cash',
      counterSessionId: params.counterSessionId,
      counterId: params.counterId,
    }),
  ]);
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'expense',
    sourceId: params.expenseId,
    sourceNo: `EXP-${params.expenseId}`,
    eventType: 'EXPENSE_PAID',
    movementDirection: 'out',
    cashStatus: 'EXPENSE_PAID',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: 0,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: Number(params.userId),
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'expense',
    currentLocationLabel: params.category || 'Expense paid',
    referenceType: 'expense',
    referenceId: params.expenseId,
    note: params.description || params.category || null,
    metadata: {
      category: params.category ?? null,
      description: params.description ?? null,
      shadowSource: 'expenses',
    },
    idempotencyKey: `cash-ledger:expense:${params.expenseId}:${params.idempotencySuffix}`,
    createdBy: Number(params.userId),
    occurredAt,
    canonicalBridge: {
      currencyCode: 'BDT',
      businessDate: params.businessDate,
      sourceEvidenceSha256,
      accountingEventPublicId,
      cashCustodyEventPublicId,
      accountingEventType: 'canonical.accounting.expense.paid',
      expenseMappingKey: 'expense_default',
    },
  });
}

expenseRoutes.get('/', requireRole(...EXPENSE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, category, status } = c.req.query();

  let query = `
    SELECT
      e.*,
      COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) AS receipt_status,
      u_creator.name  AS created_by_name,
      u_approver.name AS approved_by_name,
      u_receipt_uploader.name AS receipt_uploaded_by_name,
      u_receipt_verifier.name AS receipt_verified_by_name,
      u_receipt_rejector.name AS receipt_rejected_by_name
    FROM expenses e
    LEFT JOIN users u_creator  ON e.created_by  = u_creator.id
    LEFT JOIN users u_approver ON e.approved_by = u_approver.id
    LEFT JOIN users u_receipt_uploader ON e.receipt_uploaded_by = u_receipt_uploader.id
    LEFT JOIN users u_receipt_verifier ON e.receipt_verified_by = u_receipt_verifier.id
    LEFT JOIN users u_receipt_rejector ON e.receipt_rejected_by = u_receipt_rejector.id
    WHERE e.tenant_id = ?
  `;
  const params: any[] = [tenantId];

  if (startDate) {
    query += ' AND e.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND e.date <= ?';
    params.push(endDate);
  }
  if (category) {
    query += ' AND e.category = ?';
    params.push(category);
  }
  if (status) {
    query += ' AND COALESCE(e.approval_status, e.status) = ?';
    params.push(status);
  }

  query += ' ORDER BY e.date DESC, e.id DESC';

  try {
    const result = await db.$client.prepare(query).bind(...params).all();
    return c.json({ expenses: result.results });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    return c.json({ error: 'Failed to fetch expenses' }, 500);
  }
});

expenseRoutes.get('/pending', requireRole(...EXPENSE_APPROVAL_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  try {
    const result = await db.$client.prepare(`
      SELECT
        e.*,
        COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) AS receipt_status,
        u.name as created_by_name
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      WHERE e.tenant_id = ? AND COALESCE(e.approval_status, e.status) = 'pending'
      ORDER BY e.date DESC, e.id DESC
    `).bind(tenantId).all();

    return c.json({ expenses: result.results });
  } catch (error) {
    console.error('Error fetching pending expenses:', error);
    return c.json({ error: 'Failed to fetch pending expenses' }, 500);
  }
});

expenseRoutes.post('/', requireRole(...EXPENSE_WRITE_ROLES), zValidator('json', createExpenseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role') ?? '';
  const { date, category, amount, description, payeeName, idempotencyKey, paidFromDrawer } = c.req.valid('json');

  try {
    if (idempotencyKey) {
      const existingExpense = await loadExpenseByIdempotencyKey(c, tenantId, idempotencyKey);
      if (existingExpense) {
        return c.json(buildExistingExpenseCreateResponse(existingExpense));
      }
    }

    const approvalThreshold = await loadExpenseApprovalThreshold(c.env.DB, tenantId);
    const approvalRequired = amount > approvalThreshold;
    const isReceptionCashier = role === 'reception' || role === 'receptionist';
    const paidFromDrawerRequested = Boolean(paidFromDrawer);
    if (paidFromDrawerRequested && !isReceptionCashier) {
      throw new HTTPException(403, { message: 'Only an active reception cashier can mark an expense as already paid from drawer cash.' });
    }
    const approvalStatus = approvalRequired ? 'pending' : 'approved';
    const paymentStatus = approvalRequired && !paidFromDrawerRequested ? 'unpaid' : 'paid';
    await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Expense creation');

    let activeReceptionSession: Awaited<ReturnType<typeof loadActiveBillingCounterSession>> = null;
    if (paymentStatus === 'paid' && isReceptionCashier) {
      activeReceptionSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
        workstationId: getBillingWorkstationId(c),
        requireCurrentWorkstation: true,
      });
      if (!activeReceptionSession) {
        throw new HTTPException(400, { message: 'Open an active billing counter before recording a drawer cash expense.' });
      }
      const cashSummary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, activeReceptionSession.id);
      if (amount > cashSummary.expectedCash) {
        throw new HTTPException(400, { message: `Cannot record expense ${amount}. Available drawer cash is ${cashSummary.expectedCash.toFixed(2)}` });
      }
    }

    let result: any;
    const approvedAt = approvalStatus === 'approved' ? new Date().toISOString() : null;
    const executedAt = paymentStatus === 'paid' ? new Date().toISOString() : null;

    if (activeReceptionSession && paymentStatus === 'paid') {
      await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Reception petty cash expense');
      const batchResult = await c.env.DB.batch([
        c.env.DB.prepare(`
          INSERT INTO expenses (
            date, category, amount, description, payee_name,
            status, approval_status, payment_status, approval_required, approval_threshold,
            receipt_status, tenant_id, created_by, approved_by, approved_at,
            counter_session_id, executed_by, executed_at, execution_idempotency_key
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_uploaded', ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          date,
          category,
          amount,
          description || null,
          payeeName || null,
          approvalStatus,
          approvalStatus,
          paymentStatus,
          approvalRequired ? 1 : 0,
          approvalThreshold,
          tenantId,
          userId,
          userId,
          approvedAt,
          activeReceptionSession.id,
          userId,
          executedAt,
          idempotencyKey ?? null,
        ),
        c.env.DB.prepare(`
          INSERT INTO cash_drawer_movements
            (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
          SELECT ?, ?, ?, ?, 'cash_out', ?, 'cash', 'expense', CAST(last_insert_rowid() AS TEXT), ?, ?
        `).bind(
          tenantId,
          activeReceptionSession.id,
          activeReceptionSession.counter_id,
          userId,
          amount,
          description || category,
          userId,
        ),
        c.env.DB.prepare(`
          UPDATE expenses
          SET cash_movement_id = last_insert_rowid()
          WHERE tenant_id = ?
            AND id = (
              SELECT CAST(reference_id AS INTEGER)
              FROM cash_drawer_movements
              WHERE id = last_insert_rowid()
                AND tenant_id = ?
                AND reference_type = 'expense'
                AND movement_type = 'cash_out'
            )
            AND cash_movement_id IS NULL
        `).bind(tenantId, tenantId),
        c.env.DB.prepare(`
          INSERT INTO cash_drawer_movements
            (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
          SELECT NULL, ?, ?, ?, 'cash_out', 0, 'cash', 'expense_guard', NULL, 'expense transition guard', ?
          WHERE EXISTS (
            SELECT 1
            FROM expenses e
            JOIN cash_drawer_movements m ON m.id = last_insert_rowid()
            WHERE e.tenant_id = ?
              AND e.id = CAST(m.reference_id AS INTEGER)
              AND e.cash_movement_id IS NULL
          )
        `).bind(activeReceptionSession.id, activeReceptionSession.counter_id, userId, userId, tenantId),
        c.env.DB.prepare(`
          INSERT OR IGNORE INTO accounting_posting_events
            (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
          SELECT e.tenant_id,
                 'direct_expense:' || e.id || ':direct_expense_paid',
                 'direct_expense',
                 e.id,
                 'direct_expense_paid',
                 e.date,
                 json_object('expenseId', e.id, 'category', e.category, 'amount', e.amount, 'paymentMethod', 'cash', 'description', e.description),
                 ?
          FROM expenses e
          WHERE e.tenant_id = ?
            AND e.cash_movement_id = last_insert_rowid()
        `).bind(userId, tenantId),
      ]);
      result = batchResult[0];
    } else {
      result = await db.$client.prepare(`
        INSERT INTO expenses (
          date, category, amount, description, payee_name,
          status, approval_status, payment_status, approval_required, approval_threshold,
          receipt_status, tenant_id, created_by, approved_by, approved_at,
          counter_session_id, executed_by, executed_at, execution_idempotency_key
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'not_uploaded', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        date,
        category,
        amount,
        description || null,
        payeeName || null,
        approvalStatus,
        approvalStatus,
        paymentStatus,
        approvalRequired ? 1 : 0,
        approvalThreshold,
        tenantId,
        userId,
        approvalStatus === 'approved' ? userId : null,
        approvedAt,
        activeReceptionSession?.id ?? null,
        paymentStatus === 'paid' ? userId : null,
        executedAt,
        idempotencyKey ?? null,
      ).run();
    }

    const expenseId = result.meta.last_row_id;

    if (paymentStatus === 'paid') {
      await recordAndQueueDirectExpenseAccountingEvent(c, {
        tenantId,
        userId,
        expenseId,
        date,
        category,
        amount,
        description: description || null,
        paymentMethod: 'cash',
      });
    }

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'expenses',
      Number(expenseId),
      null,
      { date, category, amount, description, payeeName, approvalStatus, paymentStatus, receiptStatus: 'not_uploaded' },
    );

    if (activeReceptionSession && paymentStatus === 'paid') {
      await shadowWriteExpenseCashOut({
        db: c.env.DB,
        tenantId,
        expenseId,
        amount,
        category,
        description: description || null,
        userId,
        counterSessionId: activeReceptionSession.id,
        counterId: activeReceptionSession.counter_id,
        occurredAt: executedAt,
        businessDate: date,
        idempotencySuffix: 'create-paid',
      });
    }

    return c.json({
      success: true,
      id: expenseId,
      status: approvalStatus,
      approvalStatus,
      paymentStatus,
      receiptStatus: 'not_uploaded',
      expense: {
        id: expenseId,
        date,
        category,
        amount,
        description: description || null,
        payeeName: payeeName || null,
        status: approvalStatus,
        approvalStatus,
        paymentStatus,
        approvalRequired,
        approvalThreshold,
      },
      message: approvalStatus === 'pending' ? 'Expense created. Requires director approval before cash execution.' : 'Expense created successfully',
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (idempotencyKey && isUniqueConstraintError(error)) {
      const existingExpense = await loadExpenseByIdempotencyKey(c, tenantId, idempotencyKey);
      if (existingExpense) {
        return c.json(buildExistingExpenseCreateResponse(existingExpense));
      }
    }
    console.error('Error creating expense:', error);
    return c.json({ error: 'Failed to create expense' }, 500);
  }
});


expenseRoutes.get('/receipt-queue', requirePermission(EXPENSE_RECEIPT_UPLOAD_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate } = c.req.query();

  let query = `
    SELECT
      e.id,
      e.date,
      e.category,
      e.amount,
      e.description,
      e.payee_name,
      e.status,
      e.receipt_key,
      COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) AS receipt_status,
      e.receipt_rejection_reason,
      e.receipt_uploaded_at,
      e.receipt_rejected_at,
      u_creator.name AS created_by_name
    FROM expenses e
    LEFT JOIN users u_creator ON e.created_by = u_creator.id
    WHERE e.tenant_id = ?
      AND COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) IN ('not_uploaded', 'rejected')
  `;
  const params: any[] = [tenantId];

  if (startDate) {
    query += ' AND e.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND e.date <= ?';
    params.push(endDate);
  }

  query += ' ORDER BY e.date DESC, e.id DESC';

  try {
    const result = await db.$client.prepare(query).bind(...params).all();
    return c.json({ expenses: result.results });
  } catch (error) {
    console.error('Error fetching receipt upload queue:', error);
    return c.json({ error: 'Failed to fetch receipt upload queue' }, 500);
  }
});

expenseRoutes.get('/:id', requireRole(...EXPENSE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const result = await db.$client.prepare(`
      SELECT
        e.*,
        COALESCE(e.receipt_status, CASE WHEN e.receipt_key IS NULL THEN 'not_uploaded' ELSE 'uploaded' END) AS receipt_status,
        u.name as created_by_name,
        a.name as approved_by_name,
        ru.name AS receipt_uploaded_by_name,
        rv.name AS receipt_verified_by_name,
        rr.name AS receipt_rejected_by_name
      FROM expenses e
      LEFT JOIN users u ON e.created_by = u.id
      LEFT JOIN users a ON e.approved_by = a.id
      LEFT JOIN users ru ON e.receipt_uploaded_by = ru.id
      LEFT JOIN users rv ON e.receipt_verified_by = rv.id
      LEFT JOIN users rr ON e.receipt_rejected_by = rr.id
      WHERE e.id = ? AND e.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    return c.json({ expense: result });
  } catch (error) {
    console.error('Error fetching expense:', error);
    return c.json({ error: 'Failed to fetch expense' }, 500);
  }
});

expenseRoutes.put('/:id', requireRole(...EXPENSE_WRITE_ROLES), zValidator('json', updateExpenseSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const { date, category, amount, description } = c.req.valid('json');

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    const oldStatus = existing.status;
    if (oldStatus === 'pending') {
      return c.json({ error: 'Cannot edit pending expense. Approve or reject first.' }, 400);
    }

    if (await hasDirectExpenseAccountingEvent(c.env.DB, tenantId, id)) {
      throw new HTTPException(409, { message: 'Posted expense cannot be edited. Create a reversal journal instead.' });
    }

    const existingDate = String(existing.date);
    const targetDate = date || existingDate;
    await assertAccountingPeriodOpen(c.env.DB, tenantId, existingDate, 'Expense update');
    if (targetDate !== existingDate) {
      await assertAccountingPeriodOpen(c.env.DB, tenantId, targetDate, 'Expense update');
    }

    await db.$client.prepare(`
      UPDATE expenses SET date = ?, category = ?, amount = ?, description = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(
      targetDate,
      category || existing.category,
      amount || existing.amount,
      description !== undefined ? description : existing.description,
      id,
      tenantId,
    ).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPDATE',
      'expenses',
      safeInt(id),
      existing,
      { date, category, amount, description },
    );

    return c.json({ success: true, message: 'Expense updated successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error updating expense:', error);
    return c.json({ error: 'Failed to update expense' }, 500);
  }
});

expenseRoutes.post('/:id/approve', requireRole(...EXPENSE_APPROVAL_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const actorId = Number(userId);
  const actorRole = String(c.get('role') ?? '');
  const id = c.req.param('id');
  const body = await readOptionalJson(c) as { notes?: unknown };
  const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    const currentApprovalStatus = String(existing.approval_status ?? existing.status ?? 'pending');
    if (currentApprovalStatus !== 'pending') {
      if (currentApprovalStatus === 'approved') {
        if (String(existing.status ?? '') !== 'approved') {
          await db.$client.prepare(`
            UPDATE expenses
            SET status = 'approved',
                approved_by = COALESCE(approved_by, ?),
                approved_at = COALESCE(approved_at, ?)
            WHERE id = ? AND tenant_id = ?
          `).bind(userId, new Date().toISOString(), id, tenantId).run();
        }

        return c.json({
          success: true,
          message: 'Expense was already approved.',
          expense: {
            id: safeInt(id),
            approvalStatus: 'approved',
            paymentStatus: String(existing.payment_status ?? 'unpaid'),
          },
        });
      }
      return c.json({ error: 'Expense is not pending approval' }, 400);
    }

    await assertAccountingPeriodOpen(c.env.DB, tenantId, String(existing.date), 'Expense approval');

    const decision = await recordSourceApprovalDecision(c.env.DB, {
      tenantId,
      approvalSource: 'expenses',
      approvalRequestId: safeInt(id),
      requesterId: Number(existing.created_by ?? 0),
      subjectStatus: currentApprovalStatus,
      actorId,
      actorRole,
      notes,
    });

    if (!decision.becameFullyApproved) {
      await createAuditLog(
        c.env,
        tenantId,
        userId,
        'APPROVE',
        'expenses',
        safeInt(id),
        {
          approvalStatus: currentApprovalStatus,
          approvalCount: Math.max(0, decision.approvalCount - 1),
        },
        {
          approvalStatus: decision.status,
          approvalCount: decision.approvalCount,
          requiredApprovals: decision.requiredApprovals,
          remainingApprovals: decision.remainingApprovals,
          decisionId: decision.decisionId,
          amount: Number(existing.amount ?? 0),
          category: String(existing.category ?? ''),
          date: String(existing.date ?? ''),
          receiptStatus: existing.receipt_status ?? (existing.receipt_key ? 'uploaded' : 'not_uploaded'),
          missingEvidenceWarning: !existing.receipt_key,
        },
      );

      return c.json({
        success: true,
        message: `Expense approval recorded (${decision.approvalCount}/${decision.requiredApprovals}). One more distinct approver is required.`,
        expense: {
          id: safeInt(id),
          approvalStatus: decision.status,
          paymentStatus: String(existing.payment_status ?? 'unpaid'),
          approvalCount: decision.approvalCount,
          requiredApprovals: decision.requiredApprovals,
          remainingApprovals: decision.remainingApprovals,
          approvalStage: decision.label,
          missingEvidenceWarning: !existing.receipt_key,
        },
      });
    }

    const existingPaymentStatus = String(existing.payment_status ?? 'unpaid');
    const nextPaymentStatus = existingPaymentStatus === 'paid' ? 'paid' : 'unpaid';
    const finalUpdate = await db.$client.prepare(`
      UPDATE expenses
      SET status = 'approved',
          approval_status = 'approved',
          payment_status = ?,
          approved_by = ?,
          approved_at = ?
      WHERE id = ?
        AND tenant_id = ?
        AND COALESCE(approval_status, status) = 'pending'
    `).bind(nextPaymentStatus, userId, new Date().toISOString(), id, tenantId).run();

    if (Number(finalUpdate.meta?.changes ?? 0) !== 1) {
      return c.json({ error: 'Expense approval was finalized by another reviewer' }, 409);
    }

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'APPROVE',
      'expenses',
      safeInt(id),
      {
        date: existing.date,
        category: existing.category,
        amount: Number(existing.amount ?? 0),
        description: existing.description ?? null,
        approvalStatus: currentApprovalStatus,
        paymentStatus: existing.payment_status ?? 'unpaid',
      },
      {
        date: existing.date,
        category: existing.category,
        amount: Number(existing.amount ?? 0),
        description: existing.description ?? null,
        approvalStatus: 'approved',
        paymentStatus: nextPaymentStatus,
        cashAlreadyPaid: nextPaymentStatus === 'paid',
        receiptStatus: existing.receipt_status ?? (existing.receipt_key ? 'uploaded' : 'not_uploaded'),
        approvalCount: decision.approvalCount,
        requiredApprovals: decision.requiredApprovals,
        remainingApprovals: decision.remainingApprovals,
        decisionId: decision.decisionId,
        missingEvidenceWarning: !existing.receipt_key,
      },
    );

    return c.json({
      success: true,
      message: nextPaymentStatus === 'paid'
        ? 'Expense approved successfully. Drawer cash was already recorded; no second cash execution is required.'
        : 'Expense approved successfully. Cash execution is still required.',
      expense: {
        id: safeInt(id),
        approvalStatus: 'approved',
        paymentStatus: nextPaymentStatus,
        cashAlreadyPaid: nextPaymentStatus === 'paid',
        approvalCount: decision.approvalCount,
        requiredApprovals: decision.requiredApprovals,
        remainingApprovals: decision.remainingApprovals,
        approvalStage: decision.label,
        missingEvidenceWarning: !existing.receipt_key,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof ApprovalPolicyError) {
      if (error.code === 'SELF_APPROVAL_BLOCKED' || error.code === 'UNAUTHORIZED_APPROVER') {
        return c.json({ error: error.message }, 403);
      }
      if (error.code === 'APPROVAL_NOT_FOUND') {
        return c.json({ error: error.message }, 404);
      }
      return c.json({ error: error.message }, 409);
    }
    console.error('Error approving expense:', error);
    return c.json({ error: 'Failed to approve expense' }, 500);
  }
});

expenseRoutes.post('/:id/reject', requireRole(...EXPENSE_APPROVAL_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const parsedBody = rejectExpenseSchema.safeParse(await readOptionalJson(c));
  if (!parsedBody.success) {
    return c.json({ error: parsedBody.error.flatten() }, 400);
  }

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    const currentApprovalStatus = String(existing.approval_status ?? existing.status ?? 'pending');
    if (currentApprovalStatus !== 'pending') {
      return c.json({ error: 'Expense is not pending approval' }, 400);
    }

    await assertAccountingPeriodOpen(c.env.DB, tenantId, String(existing.date), 'Expense rejection');

    const amount = roundMoney(Number(existing.amount ?? 0));
    const existingPaymentStatus = String(existing.payment_status ?? 'unpaid');
    const wasPaid = existingPaymentStatus === 'paid';
    const nextPaymentStatus = wasPaid ? 'paid' : 'unpaid';
    const recoveryAction = wasPaid ? (parsedBody.data.recoveryAction ?? 'mark_recovery_required') : undefined;
    const recoveryNote = parsedBody.data.recoveryNote || null;
    const now = new Date().toISOString();
    let cashReversed = false;
    let recoveryRequired = false;
    let recoveryStatus = 'not_required';

    if (wasPaid && recoveryAction === 'cash_returned') {
      if (!existing.counter_session_id) {
        throw new HTTPException(409, { message: 'Cannot reverse cash automatically because the original drawer session is missing.' });
      }
      await c.env.DB.batch([
        c.env.DB.prepare(`
          INSERT INTO cash_drawer_movements
            (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
          SELECT e.tenant_id, e.counter_session_id, s.counter_id, COALESCE(e.executed_by, e.created_by, ?), 'cash_in', e.amount, 'cash', 'expense_recovery', CAST(e.id AS TEXT), ?, ?
          FROM expenses e
          JOIN billing_counter_sessions s ON s.id = e.counter_session_id AND s.tenant_id = e.tenant_id
          WHERE e.id = ? AND e.tenant_id = ?
        `).bind(userId, recoveryNote || `Rejected expense #${id} cash returned`, userId, id, tenantId),
        c.env.DB.prepare(`
          INSERT INTO expense_recoveries
            (tenant_id, expense_id, amount, recovery_type, status, counter_session_id, cash_movement_id, notes, created_by, collected_by, collected_at)
          SELECT e.tenant_id, e.id, e.amount, 'cash_return', 'collected', e.counter_session_id,
                 (SELECT m.id FROM cash_drawer_movements m WHERE m.tenant_id = e.tenant_id AND m.reference_type = 'expense_recovery' AND m.reference_id = CAST(e.id AS TEXT) ORDER BY m.id DESC LIMIT 1),
                 ?, ?, ?, datetime('now', '+6 hours')
          FROM expenses e
          WHERE e.id = ? AND e.tenant_id = ?
        `).bind(recoveryNote, userId, userId, id, tenantId),
        c.env.DB.prepare(`
          UPDATE expenses
          SET status = 'rejected', approval_status = 'rejected', payment_status = 'paid', approved_by = ?, approved_at = ?,
              recovery_status = 'recovered', recovery_amount = ?, recovery_requested_at = COALESCE(recovery_requested_at, datetime('now', '+6 hours')),
              recovery_closed_at = datetime('now', '+6 hours'), recovery_note = ?,
              recovery_cash_movement_id = (SELECT m.id FROM cash_drawer_movements m WHERE m.tenant_id = expenses.tenant_id AND m.reference_type = 'expense_recovery' AND m.reference_id = CAST(expenses.id AS TEXT) ORDER BY m.id DESC LIMIT 1)
          WHERE id = ? AND tenant_id = ?
        `).bind(userId, now, amount, recoveryNote, id, tenantId),
      ]);
      cashReversed = true;
      recoveryStatus = 'recovered';
    } else if (wasPaid) {
      await c.env.DB.batch([
        c.env.DB.prepare(`
          UPDATE expenses
          SET status = 'rejected', approval_status = 'rejected', payment_status = 'paid', approved_by = ?, approved_at = ?,
              recovery_status = 'required', recovery_amount = 0, recovery_requested_at = datetime('now', '+6 hours'), recovery_note = ?
          WHERE id = ? AND tenant_id = ?
        `).bind(userId, now, recoveryNote, id, tenantId),
        c.env.DB.prepare(`
          INSERT INTO expense_recoveries
            (tenant_id, expense_id, amount, recovery_type, status, counter_session_id, notes, created_by)
          SELECT tenant_id, id, amount, 'employee_receivable', 'open', counter_session_id, ?, ?
          FROM expenses
          WHERE id = ? AND tenant_id = ?
        `).bind(recoveryNote || `Rejected drawer-paid expense #${id} requires cash recovery`, userId, id, tenantId),
      ]);
      recoveryRequired = true;
      recoveryStatus = 'required';
    } else {
      await db.$client.prepare(`
        UPDATE expenses
        SET status = 'rejected', approval_status = 'rejected', payment_status = 'unpaid', approved_by = ?, approved_at = ?,
            recovery_status = 'not_required', recovery_amount = 0, recovery_note = ?
        WHERE id = ? AND tenant_id = ?
      `).bind(userId, now, recoveryNote, id, tenantId).run();
    }

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'REJECT',
      'expenses',
      safeInt(id),
      {
        date: existing.date,
        category: existing.category,
        amount,
        description: existing.description ?? null,
        approvalStatus: currentApprovalStatus,
        paymentStatus: existing.payment_status ?? 'unpaid',
      },
      {
        date: existing.date,
        category: existing.category,
        amount,
        description: existing.description ?? null,
        approvalStatus: 'rejected',
        paymentStatus: nextPaymentStatus,
        cashReversed,
        recoveryRequired,
        recoveryStatus,
        recoveryAction: recoveryAction ?? 'not_required',
      },
    );

    return c.json({
      success: true,
      message: cashReversed
        ? 'Expense rejected and drawer cash return recorded.'
        : recoveryRequired
          ? 'Expense rejected. Drawer cash was already paid and recovery is now required.'
          : 'Expense rejected',
      cashReversed,
      recoveryRequired,
      expense: {
        id: safeInt(id),
        approvalStatus: 'rejected',
        paymentStatus: nextPaymentStatus,
        recoveryRequired,
        recoveryStatus,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error rejecting expense:', error);
    return c.json({ error: 'Failed to reject expense' }, 500);
  }
});

expenseRoutes.post('/:id/recover', requireRole(...EXPENSE_WRITE_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const parsed = recoverExpenseSchema.safeParse(await readOptionalJson(c));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) return c.json({ error: 'Expense not found' }, 404);
    const approvalStatus = String(existing.approval_status ?? existing.status ?? 'pending');
    const recoveryStatus = String(existing.recovery_status ?? 'not_required');
    if (approvalStatus !== 'rejected' || !['required', 'partially_recovered'].includes(recoveryStatus)) {
      return c.json({ error: 'Expense does not have an open recovery requirement' }, 409);
    }

    await assertAccountingPeriodOpen(c.env.DB, tenantId, String(existing.date), 'Expense recovery');
    const totalAmount = roundMoney(Number(existing.amount ?? 0));
    const alreadyRecovered = roundMoney(Number(existing.recovery_amount ?? 0));
    const remaining = roundMoney(Math.max(0, totalAmount - alreadyRecovered));
    const collectAmount = roundMoney(parsed.data.amount ?? remaining);
    if (collectAmount <= 0 || collectAmount > remaining) {
      throw new HTTPException(400, { message: `Recovery amount must be between 0.01 and ${remaining.toFixed(2)}` });
    }

    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, { workstationId: getBillingWorkstationId(c), requireCurrentWorkstation: true });
    if (!activeSession) throw new HTTPException(400, { message: 'Open an active billing counter before collecting recovery cash.' });

    const nextRecovered = roundMoney(alreadyRecovered + collectAmount);
    const nextRecoveryStatus = nextRecovered >= totalAmount ? 'recovered' : 'partially_recovered';
    const note = parsed.data.note || `Recovery collection for rejected expense #${id}`;

    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO cash_drawer_movements (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by) VALUES (?, ?, ?, ?, 'cash_in', ?, 'cash', 'expense_recovery', ?, ?, ?)`).bind(tenantId, activeSession.id, activeSession.counter_id, userId, collectAmount, id, note, userId),
      c.env.DB.prepare(`INSERT INTO expense_recoveries (tenant_id, expense_id, amount, recovery_type, status, counter_session_id, cash_movement_id, notes, created_by, collected_by, collected_at) VALUES (?, ?, ?, 'cash_return', 'collected', ?, (SELECT id FROM cash_drawer_movements WHERE tenant_id = ? AND reference_type = 'expense_recovery' AND reference_id = ? ORDER BY id DESC LIMIT 1), ?, ?, ?, datetime('now', '+6 hours'))`).bind(tenantId, id, collectAmount, activeSession.id, tenantId, id, note, userId, userId),
      c.env.DB.prepare(`UPDATE expenses SET recovery_amount = ?, recovery_status = ?, recovery_closed_at = CASE WHEN ? = 'recovered' THEN datetime('now', '+6 hours') ELSE recovery_closed_at END, recovery_note = ?, recovery_cash_movement_id = (SELECT id FROM cash_drawer_movements WHERE tenant_id = expenses.tenant_id AND reference_type = 'expense_recovery' AND reference_id = CAST(expenses.id AS TEXT) ORDER BY id DESC LIMIT 1) WHERE id = ? AND tenant_id = ? AND approval_status = 'rejected'`).bind(nextRecovered, nextRecoveryStatus, nextRecoveryStatus, note, id, tenantId),
    ]);

    await createAuditLog(c.env, tenantId, userId, 'COLLECT', 'expenses', safeInt(id), { recoveryStatus, recoveryAmount: alreadyRecovered }, { recoveryStatus: nextRecoveryStatus, recoveryAmount: nextRecovered, collectedAmount: collectAmount });
    return c.json({ success: true, message: nextRecoveryStatus === 'recovered' ? 'Expense recovery collected and closed.' : 'Partial expense recovery collected.', expense: { id: safeInt(id), approvalStatus: 'rejected', recoveryStatus: nextRecoveryStatus, recoveredAmount: nextRecovered, remainingAmount: roundMoney(Math.max(0, totalAmount - nextRecovered)) } });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error recovering expense:', error);
    return c.json({ error: 'Failed to recover expense cash' }, 500);
  }
});

expenseRoutes.post('/:id/execute', requireRole(...EXPENSE_WRITE_ROLES), zValidator('json', executeExpenseSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }

    const approvalStatus = String(existing.approval_status ?? existing.status ?? 'approved');
    const paymentStatus = String(existing.payment_status ?? (existing.status === 'approved' ? 'paid' : 'unpaid'));
    if (approvalStatus !== 'approved') {
      throw new HTTPException(409, { message: 'Expense must be approved before cash execution' });
    }
    if (paymentStatus !== 'unpaid') {
      throw new HTTPException(409, { message: 'Expense has already been executed or voided' });
    }

    await assertAccountingPeriodOpen(c.env.DB, tenantId, String(existing.date), 'Expense cash execution');

    const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!activeSession) {
      throw new HTTPException(400, { message: 'Open an active billing counter before executing an approved cash expense.' });
    }

    const amount = Number(existing.amount ?? 0);
    const cashSummary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, activeSession.id);
    if (amount > cashSummary.expectedCash) {
      throw new HTTPException(400, { message: `Cannot execute expense ${amount}. Available drawer cash is ${cashSummary.expectedCash.toFixed(2)}` });
    }

    await c.env.DB.batch([
      c.env.DB.prepare(`
        UPDATE expenses
        SET payment_status = 'paid',
            counter_session_id = ?,
            executed_by = ?,
            executed_at = datetime('now', '+6 hours'),
            execution_idempotency_key = COALESCE(?, execution_idempotency_key)
        WHERE id = ?
          AND tenant_id = ?
          AND COALESCE(approval_status, status) = 'approved'
          AND COALESCE(payment_status, 'unpaid') = 'unpaid'
          AND cash_movement_id IS NULL
      `).bind(activeSession.id, userId, data.idempotencyKey ?? null, id, tenantId),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT ?, ?, ?, ?, 'cash_out', e.amount, 'cash', 'expense', CAST(e.id AS TEXT), COALESCE(e.description, e.category, ?), ?
        FROM expenses e
        WHERE e.id = ?
          AND e.tenant_id = ?
          AND COALESCE(e.approval_status, e.status) = 'approved'
          AND e.payment_status = 'paid'
          AND e.cash_movement_id IS NULL
          AND e.counter_session_id = ?
          AND e.executed_by = ?
          AND (? IS NULL OR e.execution_idempotency_key = ?)
      `).bind(
        tenantId,
        activeSession.id,
        activeSession.counter_id,
        userId,
        `Expense #${id}`,
        userId,
        id,
        tenantId,
        activeSession.id,
        userId,
        data.idempotencyKey ?? null,
        data.idempotencyKey ?? null,
      ),
      c.env.DB.prepare(`
        UPDATE expenses
        SET cash_movement_id = (
          SELECT m.id
          FROM cash_drawer_movements m
          WHERE m.tenant_id = expenses.tenant_id
            AND m.reference_type = 'expense'
            AND m.reference_id = CAST(expenses.id AS TEXT)
            AND m.movement_type = 'cash_out'
          ORDER BY m.id DESC
          LIMIT 1
        )
        WHERE id = ?
          AND tenant_id = ?
          AND cash_movement_id IS NULL
          AND payment_status = 'paid'
          AND counter_session_id = ?
          AND executed_by = ?
      `).bind(id, tenantId, activeSession.id, userId),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT NULL, ?, ?, ?, 'cash_out', 0, 'cash', 'expense_guard', ?, 'expense execute transition guard', ?
        FROM expenses e
        WHERE e.id = ?
          AND e.tenant_id = ?
          AND e.payment_status = 'paid'
          AND e.counter_session_id = ?
          AND e.executed_by = ?
          AND e.cash_movement_id IS NULL
      `).bind(activeSession.id, activeSession.counter_id, userId, id, userId, id, tenantId, activeSession.id, userId),
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events
          (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
        SELECT e.tenant_id,
               'direct_expense:' || e.id || ':direct_expense_paid',
               'direct_expense',
               e.id,
               'direct_expense_paid',
               e.date,
               json_object('expenseId', e.id, 'category', e.category, 'amount', e.amount, 'paymentMethod', 'cash', 'description', e.description),
               ?
        FROM expenses e
        WHERE e.id = ?
          AND e.tenant_id = ?
          AND e.payment_status = 'paid'
          AND e.cash_movement_id IS NOT NULL
      `).bind(userId, id, tenantId),
    ]);

    await recordAndQueueDirectExpenseAccountingEvent(c, {
      tenantId,
      userId,
      expenseId: id,
      date: String(existing.date),
      category: String(existing.category ?? ''),
      amount,
      description: existing.description ? String(existing.description) : null,
      paymentMethod: 'cash',
    });
    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'PAYMENT',
      'expenses',
      safeInt(id),
      { approvalStatus, paymentStatus, amount },
      { approvalStatus: 'approved', paymentStatus: 'paid', amount, counterSessionId: activeSession.id },
    );

    await shadowWriteExpenseCashOut({
      db: c.env.DB,
      tenantId,
      expenseId: id,
      amount,
      category: String(existing.category ?? ''),
      description: existing.description ? String(existing.description) : null,
      userId,
      counterSessionId: activeSession.id,
      counterId: activeSession.counter_id,
      businessDate: String(existing.date),
      idempotencySuffix: `execute:${data.idempotencyKey ?? 'no-key'}`,
    });

    return c.json({
      success: true,
      message: 'Expense executed from drawer cash',
      expense: {
        id: safeInt(id),
        approvalStatus: 'approved',
        paymentStatus: 'paid',
        amount,
        counterSessionId: activeSession.id,
      },
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error executing expense:', error);
    return c.json({ error: 'Failed to execute expense' }, 500);
  }
});
// GET /api/expenses/:id/receipt — serve optional receipt photo from R2.
expenseRoutes.get('/:id/receipt', requireRole(...EXPENSE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const expense = await db.$client.prepare(`
      SELECT receipt_key FROM expenses WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first();

    if (!expense || !(expense as any).receipt_key) {
      return c.json({ error: 'No receipt found for this expense' }, 404);
    }

    const key = (expense as any).receipt_key as string;
    if (!key.startsWith(`expenses/${tenantId}/`)) {
      throw new HTTPException(403, { message: 'Forbidden' });
    }

    const obj = await getUploadObjectForResponse(c.env, key);
    if (!obj) throw new HTTPException(404, { message: 'Receipt file not found in storage' });

    const headers = new Headers();
    headers.set('Content-Type', obj.contentType ?? 'image/webp');
    headers.set('Cache-Control', 'private, max-age=3600');
    return new Response(obj.body, { headers });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error fetching receipt:', error);
    throw new HTTPException(500, { message: 'Failed to fetch receipt' });
  }
});

// POST /api/expenses/:id/receipt — upload optional voucher photo. Upload does not approve the expense.
expenseRoutes.post('/:id/receipt', requirePermission(EXPENSE_RECEIPT_UPLOAD_PERMISSION), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }
    assertValidReceiptStatus(existing);
    if (existing.receipt_status === 'verified') {
      throw new HTTPException(409, { message: 'A verified voucher cannot be replaced' });
    }

    const formData = await c.req.formData();
    const file = formData.get('receipt');

    if (!file || typeof file === 'string') {
      throw new HTTPException(400, { message: 'No receipt file provided' });
    }

    const receiptFile = file as unknown as File;
    if (!ALLOWED_RECEIPT_TYPES.includes(receiptFile.type)) {
      throw new HTTPException(400, { message: 'Invalid file type. Allowed: JPG, PNG, WebP' });
    }

    if (receiptFile.size > MAX_RECEIPT_BYTES) {
      throw new HTTPException(400, { message: 'File too large. Maximum 5MB.' });
    }

    const oldKey = existing.receipt_key as string | null;
    const ext = receiptFile.type === 'image/png' ? 'png' : receiptFile.type === 'image/jpeg' ? 'jpg' : 'webp';
    const key = `expenses/${tenantId}/${id}/${crypto.randomUUID()}.${ext}`;
    const uploadedAt = new Date().toISOString();

    // Upload new receipt first — if this fails, old receipt stays intact.
    await c.env.UPLOADS.put(key, receiptFile.stream(), {
      httpMetadata: { contentType: receiptFile.type },
      customMetadata: { tenantId, uploadedBy: String(userId), expenseId: id },
    });

    await db.$client.prepare(`
      UPDATE expenses
      SET receipt_key = ?,
          receipt_status = 'uploaded',
          receipt_uploaded_by = ?,
          receipt_uploaded_at = ?,
          receipt_verified_by = NULL,
          receipt_verified_at = NULL,
          receipt_rejected_by = NULL,
          receipt_rejected_at = NULL,
          receipt_rejection_reason = NULL
      WHERE id = ? AND tenant_id = ?
    `).bind(key, userId, uploadedAt, id, tenantId).run();

    // Delete old receipt only after new one is saved and DB updated.
    if (oldKey && oldKey.startsWith(`expenses/${tenantId}/`)) {
      await c.env.UPLOADS.delete(oldKey).catch(() => {});
    }

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'UPLOAD_RECEIPT',
      'expenses',
      safeInt(id),
      { receipt_key: oldKey, receipt_status: existing.receipt_status ?? (oldKey ? 'uploaded' : 'not_uploaded') },
      { receipt_key: key, receipt_status: 'uploaded', receipt_uploaded_by: userId, receipt_uploaded_at: uploadedAt },
    );

    return c.json({ success: true, message: 'Receipt uploaded', receiptKey: key, receiptStatus: 'uploaded' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error uploading receipt:', error);
    return c.json({ error: 'Failed to upload receipt' }, 500);
  }
});

expenseRoutes.post('/:id/receipt/verify', requireRole(...EXPENSE_RECEIPT_VERIFY_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const verifiedAt = new Date().toISOString();

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }
    assertValidReceiptStatus(existing);
    if (!existing.receipt_key) {
      return c.json({ error: 'Cannot verify receipt. No voucher photo is uploaded.' }, 400);
    }
    if (existing.receipt_status === 'rejected') {
      throw new HTTPException(409, { message: 'Replace the rejected voucher before verifying it again' });
    }

    await db.$client.prepare(`
      UPDATE expenses
      SET receipt_status = 'verified',
          receipt_verified_by = ?,
          receipt_verified_at = ?,
          receipt_rejected_by = NULL,
          receipt_rejected_at = NULL,
          receipt_rejection_reason = NULL
      WHERE id = ? AND tenant_id = ?
    `).bind(userId, verifiedAt, id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'VERIFY_RECEIPT',
      'expenses',
      safeInt(id),
      { receipt_status: existing.receipt_status ?? 'uploaded' },
      { receipt_status: 'verified', receipt_verified_by: userId, receipt_verified_at: verifiedAt },
    );

    return c.json({ success: true, message: 'Voucher verified', receiptStatus: 'verified' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error verifying receipt:', error);
    return c.json({ error: 'Failed to verify receipt' }, 500);
  }
});

expenseRoutes.post('/:id/receipt/reject', requireRole(...EXPENSE_RECEIPT_VERIFY_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const rejectedAt = new Date().toISOString();
  const body = await c.req.json().catch(() => ({})) as { reason?: string };
  const reason = body.reason?.trim() ?? '';
  if (reason.length < 3 || reason.length > 500) {
    throw new HTTPException(400, { message: 'Rejection reason must be between 3 and 500 characters' });
  }

  try {
    const existing = await loadExpense(c, tenantId, id);
    if (!existing) {
      return c.json({ error: 'Expense not found' }, 404);
    }
    assertValidReceiptStatus(existing);
    if (!existing.receipt_key) {
      return c.json({ error: 'Cannot reject receipt. No voucher photo is uploaded.' }, 400);
    }

    await db.$client.prepare(`
      UPDATE expenses
      SET receipt_status = 'rejected',
          receipt_rejected_by = ?,
          receipt_rejected_at = ?,
          receipt_rejection_reason = ?,
          receipt_verified_by = NULL,
          receipt_verified_at = NULL
      WHERE id = ? AND tenant_id = ?
    `).bind(userId, rejectedAt, reason, id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'REJECT_RECEIPT',
      'expenses',
      safeInt(id),
      { receipt_status: existing.receipt_status ?? 'uploaded' },
      { receipt_status: 'rejected', receipt_rejected_by: userId, receipt_rejected_at: rejectedAt, receipt_rejection_reason: reason },
    );

    return c.json({ success: true, message: 'Voucher rejected', receiptStatus: 'rejected' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error rejecting receipt:', error);
    return c.json({ error: 'Failed to reject receipt' }, 500);
  }
});

// GET /budget-status — budget vs actual tracking.
expenseRoutes.get('/budget-status', requireRole(...EXPENSE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const yearMonth = c.req.query('month') || new Date().toISOString().slice(0, 7);

  const budgets = await db.$client.prepare(`
    SELECT category, monthly_budget FROM expense_budgets
    WHERE tenant_id = ? AND year_month = ?
  `).bind(tenantId, yearMonth).all();

  const actuals = await db.$client.prepare(`
    SELECT category, COALESCE(SUM(amount), 0) as total_spent
    FROM expenses
    WHERE tenant_id = ? AND strftime('%Y-%m', date) = ? AND status = 'approved'
    GROUP BY category
  `).bind(tenantId, yearMonth).all();

  const budgetMap = new Map((budgets.results || []).map((b: any) => [b.category, Number(b.monthly_budget)]));
  const actualMap = new Map((actuals.results || []).map((a: any) => [a.category, Number(a.total_spent)]));
  const allCategories = new Set([...budgetMap.keys(), ...actualMap.keys()]);

  return c.json({
    month: yearMonth,
    categories: Array.from(allCategories).map(cat => {
      const budget = budgetMap.get(cat) || 0;
      const actual = actualMap.get(cat) || 0;
      return {
        category: cat,
        budget,
        actual,
        variance: budget - actual,
        utilization: budget > 0 ? (actual / budget * 100).toFixed(1) : 'N/A',
      };
    }),
  });
});

// POST /budgets — set expense budget.
expenseRoutes.post('/budgets', requireRole(...EXPENSE_APPROVAL_ROLES), zValidator('json', expenseBudgetSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { category, monthlyBudget, yearMonth } = c.req.valid('json');

  await db.$client.prepare(`
    INSERT INTO expense_budgets (tenant_id, category, monthly_budget, year_month, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, category, year_month) DO UPDATE SET monthly_budget = ?
  `).bind(tenantId, category, monthlyBudget, yearMonth, userId, monthlyBudget).run();

  return c.json({ success: true });
});

export default expenseRoutes;
