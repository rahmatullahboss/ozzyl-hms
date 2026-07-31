import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import expenseRoutes from '../../../src/routes/tenant/expenses';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness, type SqliteD1Harness } from '../../helpers/sqlite-d1';

function createSchema(harness: SqliteD1Harness): void {
  harness.sqlite.exec(`
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      date TEXT NOT NULL,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      created_by INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approval_status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      approved_by INTEGER,
      approved_at TEXT,
      receipt_status TEXT DEFAULT 'not_uploaded',
      receipt_key TEXT
    );

    CREATE TABLE approval_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_source TEXT NOT NULL DEFAULT 'approval_requests',
      approval_request_id INTEGER NOT NULL,
      approval_revision INTEGER NOT NULL DEFAULT 1,
      approver_id INTEGER NOT NULL,
      approver_role TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'approve',
      notes TEXT,
      superseded_at TEXT,
      superseded_by_revision INTEGER,
      superseded_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+6 hours')),
      UNIQUE (tenant_id, approval_source, approval_request_id, approval_revision, approver_id)
    );

    CREATE TABLE fiscal_years (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      is_active INTEGER,
      is_closed INTEGER,
      start_date TEXT,
      end_date TEXT
    );

    CREATE TABLE accounting_period_closes (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      fiscal_year_id INTEGER,
      period_name TEXT,
      status TEXT
    );

    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT,
      user_id TEXT,
      action TEXT,
      table_name TEXT,
      record_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT
    );
  `);
}

function createApp(harness: SqliteD1Harness, userId: number, role: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', '100');
    c.set('userId', String(userId));
    c.set('role', role as Variables['role']);
    c.env = {
      DB: harness.db,
      ENVIRONMENT: 'test',
      JWT_SECRET: 'test-secret',
    } as unknown as Env;
    await next();
  });
  app.route('/expenses', expenseRoutes);
  app.onError((error, c) => c.json(
    { error: error.message },
    ((error as { status?: number }).status ?? 500) as 500,
  ));
  return app;
}

async function approve(app: ReturnType<typeof createApp>, notes = '') {
  return app.request('/expenses/77/approve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ notes }),
  });
}

describe('two-person expense approval route', () => {
  let harness: SqliteD1Harness;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createSchema(harness);
    harness.sqlite.prepare(`
      INSERT INTO expenses (
        id, tenant_id, date, category, amount, description, created_by,
        status, approval_status, payment_status, receipt_status
      ) VALUES (77, '100', '2026-07-19', 'Operations', 350, 'Controlled expense', 501,
        'pending', 'pending', 'unpaid', 'not_uploaded')
    `).run();
  });

  it('keeps the expense pending after the first distinct approval even without receipt evidence', async () => {
    const response = await approve(createApp(harness, 601, 'hospital_admin'), 'First review');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      expense: {
        approvalStatus: string;
        approvalCount: number;
        requiredApprovals: number;
        remainingApprovals: number;
      };
    };
    expect(body.expense).toMatchObject({
      approvalStatus: 'partially_approved',
      approvalCount: 1,
      requiredApprovals: 2,
      remainingApprovals: 1,
    });
    expect(harness.sqlite.prepare('SELECT status, approval_status, receipt_status FROM expenses WHERE id = 77').get())
      .toEqual({ status: 'pending', approval_status: 'pending', receipt_status: 'not_uploaded' });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM approval_decisions WHERE approval_source = 'expenses'").get())
      .toEqual({ count: 1 });
  });

  it('blocks requester self-approval and duplicate reviewers', async () => {
    const self = await approve(createApp(harness, 501, 'hospital_admin'));
    expect(self.status).toBe(403);

    const first = await approve(createApp(harness, 601, 'md'));
    expect(first.status).toBe(200);
    const duplicate = await approve(createApp(harness, 601, 'md'));
    expect(duplicate.status).toBe(409);
  });

  it('finalizes the expense only after a second distinct authorized approver', async () => {
    expect((await approve(createApp(harness, 601, 'hospital_admin'))).status).toBe(200);
    const response = await approve(createApp(harness, 602, 'director'), 'Second review');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      expense: {
        approvalStatus: string;
        approvalCount: number;
        requiredApprovals: number;
        remainingApprovals: number;
      };
    };
    expect(body.expense).toMatchObject({
      approvalStatus: 'approved',
      approvalCount: 2,
      requiredApprovals: 2,
      remainingApprovals: 0,
    });
    expect(harness.sqlite.prepare('SELECT status, approval_status, approved_by FROM expenses WHERE id = 77').get())
      .toEqual({ status: 'approved', approval_status: 'approved', approved_by: 602 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM approval_decisions WHERE approval_source = 'expenses'").get())
      .toEqual({ count: 2 });
  });
});
