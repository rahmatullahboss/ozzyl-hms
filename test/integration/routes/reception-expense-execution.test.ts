import { describe, expect, it } from 'vitest';
import expenseRoutes from '../../../src/routes/tenant/expenses';
import { ACCOUNTING_EVENT_TYPES } from '../../../src/lib/accounting-posting';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const tenantId = 'tenant-1';

function cashSummaryOverride(drawerCash = 5000) {
  return (sql: string) => {
    if (/INSERT INTO sequence_counters/i.test(sql)) {
      return { first: { current_value: 1 } };
    }
    if (/FROM billing_counter_sessions s/i.test(sql) && /appointment_cash/i.test(sql)) {
      return {
        first: {
          opening_cash: drawerCash,
          cash_in: 0,
          cash_out: 0,
          manual_cash_in: 0,
          manual_cash_out: 0,
          cash_drop_total: 0,
          appointment_cash: 0,
          test_cash: 0,
          total_discount: 0,
          free_appointment_count: 0,
          doctor_payable_total: 0,
          commission_payable_total: 0,
        },
      };
    }
    return null;
  };
}

function createExpenseApp(options: {
  role?: string;
  userId?: number;
  expenses?: Record<string, unknown>[];
  drawerCash?: number;
} = {}) {
  return createTestApp({
    route: expenseRoutes,
    routePath: '/expenses',
    role: options.role ?? 'receptionist',
    userId: options.userId ?? 21,
    tenantId,
    queryOverride: cashSummaryOverride(options.drawerCash ?? 5000),
    tables: {
      expenses: options.expenses ?? [],
      billing_counter_sessions: [{
        id: 1,
        tenant_id: tenantId,
        employee_id: options.userId ?? 21,
        counter_id: 3,
        counter_name: 'Main Cash Counter',
        counter_code: 'MAIN',
        counter_type: 'billing',
        opening_cash: options.drawerCash ?? 5000,
        opened_at: '2026-06-19 08:00:00',
        status: 'active',
        workstation_id: null,
        heartbeat_at: null,
        variance_approval_status: null,
      }],
      cash_drawer_movements: [],
      cash_ledger_entries: [],
      sequence_counters: [],
      accounting_fiscal_years: [],
      accounting_period_closes: [],
    },
  });
}

describe('reception expense approval and execution', () => {
  it('does not write drawer movement when over-threshold expense is created', async () => {
    const { app, mockDB } = createExpenseApp();

    const response = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: {
        date: '2026-06-19',
        amount: 1500,
        category: 'Utilities',
        payeeName: 'Generator vendor',
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      expense: { approvalStatus: string; paymentStatus: string };
    };
    expect(body.expense.approvalStatus).toBe('pending');
    expect(body.expense.paymentStatus).toBe('unpaid');
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql))).toBe(false);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);
  });

  it('records over-threshold drawer-paid expenses immediately but keeps approval pending', async () => {
    const { app, mockDB } = createExpenseApp();

    const response = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: {
        date: '2026-06-19',
        amount: 1500,
        category: 'Utilities',
        payeeName: 'Generator vendor',
        description: 'Emergency fuel already paid',
        paidFromDrawer: true,
      },
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      expense: { approvalStatus: string; paymentStatus: string };
    };
    expect(body.expense.approvalStatus).toBe('pending');
    expect(body.expense.paymentStatus).toBe('paid');
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql) && q.sql.includes("'expense'"))).toBe(true);
    expect(mockDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(true);
  });

  it('writes drawer movement only when cashier executes an approved expense', async () => {
    const pendingExpense = {
      id: 8,
      tenant_id: tenantId,
      date: '2026-06-19',
      category: 'Utilities',
      amount: 1500,
      description: 'Generator fuel',
      payee_name: 'Generator vendor',
      status: 'pending',
      approval_status: 'pending',
      payment_status: 'unpaid',
    };

    const { app: approvalApp, mockDB: approvalDB } = createExpenseApp({
      role: 'director',
      userId: 7,
      expenses: [pendingExpense],
    });

    const approved = await jsonRequest(approvalApp, '/expenses/8/approve', { method: 'POST' });
    expect(approved.status).toBe(200);
    expect(approvalDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql))).toBe(false);
    expect(approvalDB.queries.some((q) => /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql))).toBe(false);

    const { app: cashierApp, mockDB: cashierDB } = createExpenseApp({
      role: 'receptionist',
      userId: 21,
      expenses: [{
        ...pendingExpense,
        status: 'approved',
        approval_status: 'approved',
        payment_status: 'unpaid',
      }],
    });

    const executed = await jsonRequest(cashierApp, '/expenses/8/execute', {
      method: 'POST',
      body: { idempotencyKey: 'expense-exec-key-1' },
    });

    expect(executed.status).toBe(200);
    const cashMovement = cashierDB.queries.find((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql));
    expect(cashMovement).toBeTruthy();
    expect(cashMovement?.sql).toMatch(/'expense'/);
    expect(cashMovement?.sql).toMatch(/cash_movement_id IS NULL/);
    expect(cashMovement?.params).toContain('8');
    const backfill = cashierDB.queries.find((q) => /UPDATE expenses/i.test(q.sql) && /cash_movement_id/i.test(q.sql));
    expect(backfill?.sql).toMatch(/cash_movement_id IS NULL/);

    const eventInsert = cashierDB.queries.find((q) =>
      /INSERT OR IGNORE INTO accounting_posting_events/i.test(q.sql)
      && q.sql.includes(ACCOUNTING_EVENT_TYPES.directExpensePaid)
    );
    expect(eventInsert).toBeTruthy();

    const ledgerAttempt = cashierDB.queries.find((q) => /cash_ledger_entries/i.test(q.sql));
    expect(ledgerAttempt).toBeTruthy();
  });

  it('treats legacy already-approved pending rows as idempotent approval', async () => {
    const { app } = createExpenseApp({
      role: 'director',
      userId: 7,
      expenses: [{
        id: 9,
        tenant_id: tenantId,
        date: '2026-06-19',
        category: 'MISC',
        amount: 1500,
        description: 'Legacy expense',
        payee_name: 'Legacy vendor',
        status: 'pending',
        approval_status: 'approved',
        payment_status: 'paid',
      }],
    });

    const response = await jsonRequest(app, '/expenses/9/approve', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json() as { expense?: { approvalStatus?: string; paymentStatus?: string } };
    expect(body.expense?.approvalStatus).toBe('approved');
    expect(body.expense?.paymentStatus).toBe('paid');
  });

  it('stores create idempotency keys for immediate paid reception expenses', async () => {
    const { app, mockDB } = createExpenseApp();

    const response = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: {
        date: '2026-06-19',
        amount: 120,
        category: 'MISC',
        payeeName: 'Night snack',
        idempotencyKey: 'expense-create-key-1',
      },
    });

    expect(response.status).toBe(201);
    const insertExpense = mockDB.queries.find((q) =>
      /INSERT INTO expenses/i.test(q.sql) && /execution_idempotency_key/i.test(q.sql)
    );
    expect(insertExpense).toBeTruthy();
    expect(insertExpense?.params).toContain('expense-create-key-1');
  });

  it('returns an existing expense for a repeated create idempotency key', async () => {
    const { app, mockDB } = createExpenseApp({
      expenses: [{
        id: 55,
        tenant_id: tenantId,
        date: '2026-06-19',
        category: 'MISC',
        amount: 120,
        description: null,
        payee_name: 'Night snack',
        status: 'approved',
        approval_status: 'approved',
        payment_status: 'paid',
        approval_required: 0,
        approval_threshold: 1000,
        receipt_status: 'not_uploaded',
        execution_idempotency_key: 'expense-create-key-1',
      }],
    });

    const response = await jsonRequest(app, '/expenses', {
      method: 'POST',
      body: {
        date: '2026-06-19',
        amount: 120,
        category: 'MISC',
        payeeName: 'Night snack',
        idempotencyKey: 'expense-create-key-1',
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { duplicate?: boolean; id?: number };
    expect(body.duplicate).toBe(true);
    expect(body.id).toBe(55);
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql))).toBe(false);
  });

  it('rejects a drawer-paid pending expense and marks recovery required by default', async () => {
    const { app, mockDB } = createExpenseApp({
      role: 'director',
      userId: 7,
      expenses: [{
        id: 88,
        tenant_id: tenantId,
        date: '2026-06-19',
        category: 'Utilities',
        amount: 1500,
        description: 'Emergency fuel',
        status: 'pending',
        approval_status: 'pending',
        payment_status: 'paid',
        counter_session_id: 1,
        cash_movement_id: 501,
        created_by: 21,
        executed_by: 21,
      }],
    });

    const response = await jsonRequest(app, '/expenses/88/reject', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json() as { recoveryRequired: boolean; cashReversed: boolean; expense: { recoveryStatus: string } };
    expect(body.recoveryRequired).toBe(true);
    expect(body.cashReversed).toBe(false);
    expect(body.expense.recoveryStatus).toBe('required');
    expect(mockDB.queries.some((q) => /INSERT INTO expense_recoveries/i.test(q.sql) && /employee_receivable/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql) && /cash_in/i.test(q.sql))).toBe(false);
  });

  it('rejects a drawer-paid pending expense and records immediate cash return', async () => {
    const { app, mockDB } = createExpenseApp({
      role: 'director',
      userId: 7,
      expenses: [{
        id: 89,
        tenant_id: tenantId,
        date: '2026-06-19',
        category: 'Utilities',
        amount: 1500,
        description: 'Emergency fuel',
        status: 'pending',
        approval_status: 'pending',
        payment_status: 'paid',
        counter_session_id: 1,
        cash_movement_id: 502,
        created_by: 21,
        executed_by: 21,
      }],
    });

    const response = await jsonRequest(app, '/expenses/89/reject', {
      method: 'POST',
      body: { recoveryAction: 'cash_returned', recoveryNote: 'Cash returned to drawer' },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { recoveryRequired: boolean; cashReversed: boolean; expense: { recoveryStatus: string } };
    expect(body.cashReversed).toBe(true);
    expect(body.recoveryRequired).toBe(false);
    expect(body.expense.recoveryStatus).toBe('recovered');
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql) && /cash_in/i.test(q.sql) && /expense_recovery/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /INSERT INTO expense_recoveries/i.test(q.sql) && /collected/i.test(q.sql))).toBe(true);
  });

  it('collects recovery later for a rejected drawer-paid expense', async () => {
    const { app, mockDB } = createExpenseApp({
      role: 'receptionist',
      userId: 21,
      expenses: [{
        id: 90,
        tenant_id: tenantId,
        date: '2026-06-19',
        category: 'Utilities',
        amount: 1500,
        description: 'Emergency fuel',
        status: 'rejected',
        approval_status: 'rejected',
        payment_status: 'paid',
        recovery_status: 'required',
        recovery_amount: 0,
        counter_session_id: 1,
        cash_movement_id: 503,
        created_by: 21,
        executed_by: 21,
      }],
    });

    const response = await jsonRequest(app, '/expenses/90/recover', {
      method: 'POST',
      body: { note: 'Recovered from requester' },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { expense: { recoveryStatus: string; recoveredAmount: number; remainingAmount: number } };
    expect(body.expense.recoveryStatus).toBe('recovered');
    expect(body.expense.recoveredAmount).toBe(1500);
    expect(body.expense.remainingAmount).toBe(0);
    expect(mockDB.queries.some((q) => /INSERT INTO cash_drawer_movements/i.test(q.sql) && /cash_in/i.test(q.sql))).toBe(true);
    expect(mockDB.queries.some((q) => /UPDATE expenses SET recovery_amount/i.test(q.sql))).toBe(true);
  });

  it('rejects an unpaid pending expense without opening recovery', async () => {
    const { app, mockDB } = createExpenseApp({
      role: 'director',
      userId: 7,
      expenses: [{
        id: 91,
        tenant_id: tenantId,
        date: '2026-06-19',
        category: 'Utilities',
        amount: 1500,
        description: 'Emergency fuel',
        status: 'pending',
        approval_status: 'pending',
        payment_status: 'unpaid',
      }],
    });

    const response = await jsonRequest(app, '/expenses/91/reject', { method: 'POST' });

    expect(response.status).toBe(200);
    const body = await response.json() as { recoveryRequired: boolean; expense: { recoveryStatus: string } };
    expect(body.recoveryRequired).toBe(false);
    expect(body.expense.recoveryStatus).toBe('not_required');
    expect(mockDB.queries.some((q) => /INSERT INTO expense_recoveries/i.test(q.sql))).toBe(false);
  });
});
