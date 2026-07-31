import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness, type SqliteD1Harness } from '../../helpers/sqlite-d1';

function createSchema(harness: SqliteD1Harness): void {
  harness.sqlite.exec(`
    CREATE TABLE billing_handovers (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      handover_type TEXT NOT NULL,
      handover_amount REAL NOT NULL,
      due_amount REAL,
      status TEXT NOT NULL,
      handover_by INTEGER NOT NULL,
      handover_to INTEGER,
      received_by INTEGER,
      receiver_counted_amount REAL,
      receiver_variance REAL,
      admin_verification_status TEXT,
      admin_verified_by INTEGER,
      admin_verified_at TEXT,
      admin_verification_remarks TEXT
    );

    CREATE TABLE cash_handover_verification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      handover_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL,
      actor_role TEXT NOT NULL,
      counted_amount REAL,
      expected_amount REAL,
      variance REAL,
      decision TEXT,
      remarks TEXT,
      workstation_id TEXT,
      created_at TEXT
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
  app.route('/billing-counter', billingCounterRoutes);
  app.onError((error, c) => c.json(
    { error: error.message },
    ((error as { status?: number }).status ?? 500) as 500,
  ));
  return app;
}

async function approve(app: ReturnType<typeof createApp>, remarks = '') {
  return app.request('/billing-counter/handovers/77/admin-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision: 'approve', remarks }),
  });
}

describe('two-person cash handover admin approval', () => {
  let harness: SqliteD1Harness;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createSchema(harness);
    harness.sqlite.prepare(`
      INSERT INTO billing_handovers (
        id, tenant_id, handover_type, handover_amount, due_amount, status,
        handover_by, handover_to, received_by, receiver_counted_amount,
        receiver_variance, admin_verification_status
      ) VALUES (77, '100', 'counter', 1500, 0, 'disputed', 1, 2, 2, 1450, -50, 'pending_admin')
    `).run();
  });

  it('records the first approval as 1/2 without finalizing the handover', async () => {
    const response = await approve(createApp(harness, 9, 'hospital_admin'), 'First admin review');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'partially_approved',
      finalVerificationStatus: 'pending_admin',
      approvalCount: 1,
      requiredApprovals: 2,
      remainingApprovals: 1,
    });
    expect(harness.sqlite.prepare(`
      SELECT status, admin_verification_status, admin_verified_by
      FROM billing_handovers WHERE id = 77
    `).get()).toEqual({
      status: 'disputed',
      admin_verification_status: 'pending_admin',
      admin_verified_by: null,
    });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM cash_handover_verification_events').get())
      .toEqual({ count: 0 });
  });

  it('blocks custody actors and duplicate approvers', async () => {
    expect((await approve(createApp(harness, 1, 'hospital_admin'))).status).toBe(403);
    expect((await approve(createApp(harness, 9, 'hospital_admin'))).status).toBe(200);
    expect((await approve(createApp(harness, 9, 'hospital_admin'))).status).toBe(409);
  });

  it('finalizes only after a second distinct authorized approver', async () => {
    expect((await approve(createApp(harness, 9, 'hospital_admin'))).status).toBe(200);
    const response = await approve(createApp(harness, 10, 'director'), 'Second admin review');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'received',
      finalVerificationStatus: 'verified',
      adminVerifiedBy: 10,
      approvalCount: 2,
      requiredApprovals: 2,
      remainingApprovals: 0,
    });
    expect(harness.sqlite.prepare(`
      SELECT status, admin_verification_status, admin_verified_by, due_amount
      FROM billing_handovers WHERE id = 77
    `).get()).toEqual({
      status: 'received',
      admin_verification_status: 'verified',
      admin_verified_by: 10,
      due_amount: 0,
    });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count FROM approval_decisions
      WHERE approval_source = 'billing_handovers' AND approval_request_id = 77
    `).get()).toEqual({ count: 2 });
    expect(harness.sqlite.prepare(`
      SELECT event_type, actor_user_id, decision
      FROM cash_handover_verification_events
    `).get()).toEqual({
      event_type: 'admin_final_verification',
      actor_user_id: 10,
      decision: 'approve',
    });
  });
});
