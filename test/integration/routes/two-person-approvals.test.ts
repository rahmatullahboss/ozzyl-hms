import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import approvalsRoute from '../../../src/routes/tenant/approvals';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness, type SqliteD1Harness } from '../../helpers/sqlite-d1';

function createSchema(harness: SqliteD1Harness): void {
  harness.sqlite.exec(`
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      entity_no TEXT,
      requested_by INTEGER NOT NULL,
      request_data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'approved', 'rejected')),
      reviewed_by INTEGER,
      reviewed_at TEXT,
      review_notes TEXT,
      required_approvals INTEGER NOT NULL DEFAULT 2,
      approval_count INTEGER NOT NULL DEFAULT 0,
      approval_revision INTEGER NOT NULL DEFAULT 1,
      first_approved_at TEXT,
      fully_approved_at TEXT,
      execution_status TEXT DEFAULT 'not_required',
      execution_attempts INTEGER NOT NULL DEFAULT 0,
      execution_started_at TEXT,
      execution_completed_at TEXT,
      execution_error TEXT,
      locked_by INTEGER,
      locked_at TEXT,
      info_request_status TEXT DEFAULT 'not_requested',
      info_requested_at TEXT,
      info_requested_by INTEGER,
      info_request_note TEXT,
      info_missing_items TEXT,
      info_submitted_at TEXT,
      info_submitted_by INTEGER,
      info_response_note TEXT,
      created_at TEXT DEFAULT (datetime('now', '+6 hours'))
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
      created_at TEXT DEFAULT (datetime('now', '+6 hours'))
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

    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      role TEXT
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
  app.route('/approvals', approvalsRoute);
  app.onError((error, c) => c.json({ error: error.message }, ((error as { status?: number }).status ?? 500) as 500));
  return app;
}

async function review(app: ReturnType<typeof createApp>, action: 'approve' | 'reject', notes?: string) {
  return app.request('/approvals/10/review', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...(notes ? { notes } : {}) }),
  });
}

describe('two-person approval route', () => {
  let harness: SqliteD1Harness;

  beforeEach(() => {
    harness = createSqliteD1Harness();
    createSchema(harness);
    harness.sqlite.prepare(`
      INSERT INTO approval_requests (
        id, tenant_id, type, entity_id, entity_no, requested_by, request_data, status
      ) VALUES (10, '100', 'bill_edit', 500, 'INV-500', 501, ?, 'pending')
    `).run(JSON.stringify({ reason: 'Controlled correction', evidenceRequired: true }));
  });

  it('records 1/2 without executing or marking the request fully approved', async () => {
    const response = await review(createApp(harness, 601, 'hospital_admin'), 'approve');

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { status: string; approvalCount: number; requiredApprovals: number; sideEffect?: unknown } };
    expect(body.data).toMatchObject({
      status: 'partially_approved',
      approvalCount: 1,
      requiredApprovals: 2,
    });
    expect(body.data.sideEffect).toBeUndefined();
    expect(harness.sqlite.prepare('SELECT status, approval_count FROM approval_requests WHERE id = 10').get())
      .toEqual({ status: 'pending', approval_count: 1 });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM approval_events WHERE action = 'execution_started'").get())
      .toEqual({ count: 0 });
  });

  it('fully approves on the second distinct reviewer and blocks duplicate reviewers', async () => {
    const first = await review(createApp(harness, 601, 'md'), 'approve');
    expect(first.status).toBe(200);

    const duplicate = await review(createApp(harness, 601, 'md'), 'approve');
    expect(duplicate.status).toBe(409);

    const second = await review(createApp(harness, 602, 'director'), 'approve');
    expect(second.status).toBe(200);
    const body = await second.json() as { data: { status: string; approvalCount: number; requiredApprovals: number } };
    expect(body.data).toMatchObject({ status: 'approved', approvalCount: 2, requiredApprovals: 2 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM approval_decisions WHERE approval_request_id = 10').get())
      .toEqual({ count: 2 });
  });

  it('allows approval when supporting evidence is missing', async () => {
    const response = await review(createApp(harness, 601, 'hospital_admin'), 'approve');
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { status: string } };
    expect(body.data.status).toBe('partially_approved');
  });

  it('exposes current reviewer eligibility for partially approved requests', async () => {
    await review(createApp(harness, 601, 'hospital_admin'), 'approve');

    const firstReviewerList = await createApp(harness, 601, 'hospital_admin').request('/approvals?status=pending&type=bill_edit');
    expect(firstReviewerList.status).toBe(200);
    const firstBody = await firstReviewerList.json() as { data: Array<Record<string, unknown>> };
    expect(firstBody.data[0]).toMatchObject({
      id: 10,
      status: 'partially_approved',
      approval_count: 1,
      current_user_approved: true,
      can_current_user_approve: false,
      approval_blocked_reason: 'You already approved this request',
    });

    const secondReviewerList = await createApp(harness, 602, 'director').request('/approvals?status=pending&type=bill_edit');
    expect(secondReviewerList.status).toBe(200);
    const secondBody = await secondReviewerList.json() as { data: Array<Record<string, unknown>> };
    expect(secondBody.data[0]).toMatchObject({
      id: 10,
      status: 'partially_approved',
      approval_count: 1,
      current_user_approved: false,
      can_current_user_approve: true,
      approval_blocked_reason: null,
    });
  });

  it('treats a prior-revision approver as eligible after return for correction', async () => {
    const first = await review(createApp(harness, 601, 'hospital_admin'), 'approve');
    expect(first.status).toBe(200);

    const returned = await createApp(harness, 602, 'director').request('/approvals/10/request-info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Attach corrected evidence', missingItems: ['evidence'] }),
    });
    expect(returned.status).toBe(200);
    await expect(returned.json()).resolves.toMatchObject({
      data: { approvalRevision: 2, approvalCount: 0, requiredApprovals: 2 },
    });

    const submitted = await createApp(harness, 501, 'reception').request('/approvals/10/submit-info', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ notes: 'Corrected evidence attached' }),
    });
    expect(submitted.status).toBe(200);

    const priorReviewerList = await createApp(harness, 601, 'hospital_admin')
      .request('/approvals?status=pending&type=bill_edit');
    expect(priorReviewerList.status).toBe(200);
    const body = await priorReviewerList.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]).toMatchObject({
      id: 10,
      approval_revision: 2,
      approval_count: 0,
      current_user_approved: false,
      can_current_user_approve: true,
      approval_blocked_reason: null,
    });
  });

  it('applies the same distinct-review policy to safe bulk approvals', async () => {
    harness.sqlite.prepare(`
      INSERT INTO approval_requests (
        id, tenant_id, type, entity_id, entity_no, requested_by, request_data, status
      ) VALUES (11, '100', 'bill_edit', 501, 'INV-501', 502, ?, 'pending')
    `).run(JSON.stringify({ reason: 'Second controlled correction' }));

    const firstApp = createApp(harness, 601, 'hospital_admin');
    const first = await firstApp.request('/approvals/bulk-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [10, 11], action: 'approve' }),
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { data: { status: string; partiallyApproved: number; fullyApproved: number } };
    expect(firstBody.data).toMatchObject({
      status: 'partially_approved',
      partiallyApproved: 2,
      fullyApproved: 0,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM approval_requests WHERE status = 'pending' AND approval_count = 1").get())
      .toEqual({ count: 2 });

    const secondApp = createApp(harness, 602, 'director');
    const second = await secondApp.request('/approvals/bulk-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [10, 11], action: 'approve' }),
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as { data: { status: string; partiallyApproved: number; fullyApproved: number } };
    expect(secondBody.data).toMatchObject({
      status: 'approved',
      partiallyApproved: 0,
      fullyApproved: 2,
    });
    expect(harness.sqlite.prepare("SELECT COUNT(*) AS count FROM approval_requests WHERE status = 'approved'").get())
      .toEqual({ count: 2 });
  });
});
