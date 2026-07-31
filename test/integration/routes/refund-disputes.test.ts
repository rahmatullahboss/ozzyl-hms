import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import refundDisputesRoute from '../../../src/routes/tenant/refundDisputes';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

function setup() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT,
      email TEXT
    );
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT,
      patient_id INTEGER
    );
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      entity_no TEXT,
      requested_by INTEGER NOT NULL,
      request_data TEXT,
      status TEXT NOT NULL,
      execution_status TEXT,
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE approval_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      actor_id INTEGER,
      old_status TEXT,
      new_status TEXT,
      notes TEXT,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE billing_refund_cash_holds (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      custody_user_id INTEGER,
      resolved_by INTEGER,
      resolution_reason TEXT,
      updated_at TEXT
    );
    CREATE TABLE billing_refund_cash_disputes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      refund_cash_hold_id INTEGER NOT NULL,
      approval_request_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      requester_user_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      status TEXT NOT NULL,
      rejection_reason TEXT NOT NULL,
      rejected_by INTEGER NOT NULL,
      rejected_at TEXT,
      custody_user_id INTEGER,
      counter_id INTEGER NOT NULL,
      counter_session_id INTEGER NOT NULL,
      dispute_cash_movement_id INTEGER,
      settlement_method TEXT,
      settlement_reference_type TEXT,
      settlement_reference_id INTEGER,
      settlement_idempotency_key TEXT,
      settled_by INTEGER,
      settled_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE (tenant_id, refund_cash_hold_id),
      UNIQUE (tenant_id, settlement_idempotency_key)
    );
    CREATE TABLE doctor_commission_accruals (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      commission_base_amount REAL NOT NULL,
      earned_commission_amount REAL NOT NULL,
      doctor_waiver_amount REAL NOT NULL,
      payable_commission_amount REAL NOT NULL,
      commission_amount REAL NOT NULL,
      paid_amount REAL NOT NULL DEFAULT 0,
      balance_amount REAL NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      updated_at TEXT
    );
    CREATE TABLE billing_refund_commission_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      refund_cash_hold_id INTEGER NOT NULL,
      bill_id INTEGER NOT NULL,
      accrual_id INTEGER NOT NULL,
      invoice_item_id INTEGER,
      allocated_refund_amount REAL NOT NULL,
      commission_base_reduction REAL NOT NULL,
      reserved_commission_amount REAL NOT NULL,
      original_commission_base_amount REAL NOT NULL,
      original_earned_commission_amount REAL NOT NULL,
      original_doctor_waiver_amount REAL NOT NULL,
      original_payable_commission_amount REAL NOT NULL,
      original_balance_amount REAL NOT NULL,
      reserved_commission_base_amount REAL NOT NULL,
      reserved_earned_commission_amount REAL NOT NULL,
      reserved_doctor_waiver_amount REAL NOT NULL,
      reserved_payable_commission_amount REAL NOT NULL,
      reserved_balance_amount REAL NOT NULL,
      status TEXT NOT NULL,
      created_by INTEGER,
      resolved_by INTEGER,
      resolution_reason TEXT,
      created_at TEXT,
      updated_at TEXT,
      resolved_at TEXT
    );
    CREATE TABLE billing_refund_batch_guard (
      tenant_id TEXT NOT NULL,
      operation_key TEXT NOT NULL,
      step_key TEXT NOT NULL,
      assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
      created_at TEXT,
      PRIMARY KEY (tenant_id, operation_key, step_key)
    );
    CREATE TABLE billing_counters (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_name TEXT,
      counter_code TEXT,
      is_active INTEGER
    );
    CREATE TABLE billing_counter_sessions (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      counter_type TEXT,
      opening_cash REAL,
      opened_at TEXT,
      status TEXT NOT NULL,
      variance_approval_status TEXT,
      workstation_id TEXT,
      heartbeat_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE cash_drawer_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      counter_session_id INTEGER NOT NULL,
      counter_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      movement_type TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT,
      description TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_by INTEGER,
      created_at TEXT,
      UNIQUE (tenant_id, reference_type, reference_id, movement_type)
    );
    CREATE TABLE fiscal_years (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE accounting_period_closes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      fiscal_year_id INTEGER,
      period_name TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE accounting_account_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      mapping_key TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_by TEXT,
      UNIQUE (tenant_id, source_event_key)
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

    INSERT INTO fiscal_years (id, tenant_id, start_date, end_date, is_active, is_closed)
    VALUES (1, 'tenant-1', '2026-01-01', '2026-12-31', 1, 0);
    INSERT INTO accounting_account_mappings (tenant_id, mapping_key, account_id, is_active) VALUES
      ('tenant-1', 'cash', 1, 1),
      ('tenant-1', 'employee_dispute_receivable', 2, 1),
      ('tenant-1', 'general_expense', 3, 1);
    INSERT INTO users VALUES
      (1, 'tenant-1', 'Director One', 'director@example.com'),
      (3, 'tenant-1', 'Nusrat Jahan Sony', 'nusrat@example.com');
    INSERT INTO patients VALUES (50, 'tenant-1', 'Tania');
    INSERT INTO bills VALUES (75, 'tenant-1', 'INV-D-2026-000703', 50);
    INSERT INTO approval_requests (
      id, tenant_id, type, entity_id, entity_no, requested_by,
      request_data, status, execution_status
    ) VALUES (
      55, 'tenant-1', 'refund', 75, 'INV-D-2026-000703', 3,
      '{"refundKind":"amount_partial_refund","requestedRefundAmount":400,"reason":"Discount entered after payment"}',
      'rejected', 'pending'
    );
    INSERT INTO billing_refund_cash_holds VALUES
      (9, 'tenant-1', 55, 75, 50, 400, 3, 7, 17, 'disputed', NULL, 1, 'Refund not justified', datetime('now'));
    INSERT INTO doctor_commission_accruals (
      id, tenant_id, commission_base_amount, earned_commission_amount,
      doctor_waiver_amount, payable_commission_amount, commission_amount,
      paid_amount, balance_amount, status, notes
    ) VALUES (300, 'tenant-1', 300, 75, 0, 75, 75, 0, 75, 'accrued', 'Refund commission held');
    INSERT INTO billing_refund_commission_reservations (
      id, tenant_id, approval_request_id, refund_cash_hold_id, bill_id,
      accrual_id, invoice_item_id, allocated_refund_amount,
      commission_base_reduction, reserved_commission_amount,
      original_commission_base_amount, original_earned_commission_amount,
      original_doctor_waiver_amount, original_payable_commission_amount,
      original_balance_amount, reserved_commission_base_amount,
      reserved_earned_commission_amount, reserved_doctor_waiver_amount,
      reserved_payable_commission_amount, reserved_balance_amount,
      status, created_by
    ) VALUES (
      700, 'tenant-1', 55, 9, 75, 300, 101, 100,
      100, 25, 400, 100, 0, 100, 100,
      300, 75, 0, 75, 75, 'disputed', 3
    );
    INSERT INTO billing_refund_cash_disputes (
      id, tenant_id, refund_cash_hold_id, approval_request_id, bill_id,
      requester_user_id, amount, status, rejection_reason, rejected_by,
      rejected_at, custody_user_id, counter_id, counter_session_id,
      dispute_cash_movement_id, created_at, updated_at
    ) VALUES (
      31, 'tenant-1', 9, 55, 75, 3, 400, 'open',
      'Refund not justified', 1, datetime('now'), NULL, 7, 17, 501,
      datetime('now'), datetime('now')
    );
    INSERT INTO billing_counters VALUES (9, 'tenant-1', 'Accounts', 'ACC-1', 1);
    INSERT INTO billing_counter_sessions VALUES
      (88, 'tenant-1', 9, 1, 'billing', 1000, datetime('now'), 'active', NULL, 'workstation-123', NULL, datetime('now'));
  `);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', 'tenant-1');
    c.set('userId', '1');
    c.set('role', 'director');
    c.env = { DB: harness.db, ENVIRONMENT: 'test' } as unknown as Env;
    await next();
  });
  app.route('/refund-disputes', refundDisputesRoute);
  app.onError((error, c) => c.json({ error: error.message }, 500));
  return { harness, app };
}

describe('refund dispute settlement API', () => {
  it('lists requester-owned disputes with bill and patient context', async () => {
    const { app } = setup();
    const response = await app.request('/refund-disputes?status=open');
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data).toEqual([
      expect.objectContaining({
        id: 31,
        invoiceNo: 'INV-D-2026-000703',
        patientName: 'Tania',
        requesterUserId: 3,
        requesterName: 'Nusrat Jahan Sony',
        amount: 400,
        status: 'open',
        holdStatus: 'disputed',
      }),
    ]);
  });

  it('creates one controlled write-off approval and marks the dispute pending', async () => {
    const { app, harness } = setup();
    const response = await app.request('/refund-disputes/31/writeoff-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idempotencyKey: 'writeoff-dispute-31',
        reason: 'Management approved loss recognition review',
        evidence: { memo: 'Management memo #22' },
      }),
    });
    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.data.dispute).toMatchObject({ id: 31, status: 'writeoff_pending' });
    expect(body.data.approvalRequestId).toBeGreaterThan(55);
    expect(harness.sqlite.prepare(`
      SELECT type, entity_id, status, execution_status,
             json_extract(request_data, '$.kind') AS kind,
             json_extract(request_data, '$.refundDisputeId') AS dispute_id
      FROM approval_requests
      WHERE id = ?
    `).get(body.data.approvalRequestId)).toEqual({
      type: 'manual_adjustment',
      entity_id: 31,
      status: 'pending',
      execution_status: 'pending',
      kind: 'refund_dispute_writeoff',
      dispute_id: 31,
    });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM approval_events WHERE action = \'created\'').get()).toEqual({ count: 1 });
  });

  it('does not create an orphan approval when a second write-off request races with a different key', async () => {
    const { app, harness } = setup();
    const [first, second] = await Promise.all([
      app.request('/refund-disputes/31/writeoff-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: 'writeoff-dispute-31-first',
          reason: 'First controlled write-off request',
        }),
      }),
      app.request('/refund-disputes/31/writeoff-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: 'writeoff-dispute-31-second',
          reason: 'Racing controlled write-off request',
        }),
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([201, 409]);
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM approval_requests
      WHERE tenant_id = 'tenant-1'
        AND type = 'manual_adjustment'
        AND json_extract(request_data, '$.kind') = 'refund_dispute_writeoff'
    `).get()).toEqual({ count: 1 });
  });

  it('recovers disputed cash into the active workstation counter and settles the hold', async () => {
    const { app, harness } = setup();
    const response = await app.request('/refund-disputes/31/recover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMS-Workstation-ID': 'workstation-123',
      },
      body: JSON.stringify({ idempotencyKey: 'recover-dispute-31', notes: 'Requester returned cash' }),
    });
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.data).toMatchObject({ id: 31, status: 'recovered', settlementMethod: 'cash_recovery' });
    expect(harness.sqlite.prepare(`
      SELECT movement_type, amount, counter_session_id, reference_type, reference_id
      FROM cash_drawer_movements
      WHERE movement_type = 'cash_in'
    `).get()).toEqual({
      movement_type: 'cash_in',
      amount: 400,
      counter_session_id: 88,
      reference_type: 'refund_cash_dispute',
      reference_id: 9,
    });
    expect(harness.sqlite.prepare('SELECT status FROM billing_refund_cash_holds WHERE id = 9').get()).toEqual({ status: 'settled' });
    expect(harness.sqlite.prepare(`
      SELECT commission_base_amount, earned_commission_amount,
             payable_commission_amount, commission_amount, balance_amount
      FROM doctor_commission_accruals
      WHERE id = 300
    `).get()).toEqual({
      commission_base_amount: 400,
      earned_commission_amount: 100,
      payable_commission_amount: 100,
      commission_amount: 100,
      balance_amount: 100,
    });
    expect(harness.sqlite.prepare(`
      SELECT status FROM billing_refund_commission_reservations WHERE id = 700
    `).get()).toEqual({ status: 'released' });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM accounting_posting_events
      WHERE source_type = 'doctor_commission_refund_reservation_release'
        AND event_type = 'commission_accrued'
    `).get()).toEqual({ count: 1 });
    const event = harness.sqlite.prepare(`
      SELECT event_type, payload_json
      FROM accounting_posting_events
      WHERE source_type = 'refund_cash_dispute_recovered'
    `).get() as { event_type: string; payload_json: string };
    expect(event.event_type).toBe('manual_journal');
    expect(JSON.parse(event.payload_json)).toMatchObject({
      lines: [
        { accountId: 1, debit: 400, credit: 0 },
        { accountId: 2, debit: 0, credit: 400 },
      ],
    });
  });

  it('blocks cash recovery in a closed accounting period without partial mutation', async () => {
    const { app, harness } = setup();
    harness.sqlite.prepare(`
      INSERT INTO accounting_period_closes (tenant_id, fiscal_year_id, period_name, status)
      VALUES ('tenant-1', 1, '2026-07', 'closed')
    `).run();

    const response = await app.request('/refund-disputes/31/recover', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HMS-Workstation-ID': 'workstation-123',
      },
      body: JSON.stringify({ idempotencyKey: 'recover-dispute-closed-31' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/accounting period 2026-07 is closed/i) });
    expect(harness.sqlite.prepare('SELECT status FROM billing_refund_cash_disputes WHERE id = 31').get()).toEqual({ status: 'open' });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM cash_drawer_movements WHERE movement_type = 'cash_in'").get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM accounting_posting_events WHERE source_type = 'refund_cash_dispute_recovered'").get()).toEqual({ count: 0 });
  });
});
