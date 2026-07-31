import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import actionCenterRoutes from '../../../src/routes/tenant/actionCenter';
import adminRoutes from '../../../src/routes/admin/withActionCenterCollections';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

const providerReviewsMigration = readFileSync('migrations/0121_provider_reviews.sql', 'utf8');
const collectionMigration = readFileSync('migrations/0501_collection_cases.sql', 'utf8');
const taskMigration = readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8');

function utcDateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const yesterdayUtc = `${utcDateOffset(-1)}T12:00:00.000Z`;
const todayUtc = `${utcDateOffset(0)}T00:00:00.000Z`;
const futureUtc = `${utcDateOffset(2)}T12:00:00.000Z`;
const laterFutureUtc = `${utcDateOffset(3)}T12:00:00.000Z`;
const completedTodayUtc = new Date().toISOString();

function setupDatabase() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(providerReviewsMigration);
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE role_permission_overrides (
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      permissions TEXT NOT NULL,
      PRIMARY KEY (tenant_id, role)
    );

    CREATE TABLE user_permission_overrides (
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      action TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id, permission)
    );

    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      mobile TEXT
    );

    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      invoice_no TEXT,
      total REAL,
      paid REAL,
      due REAL,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT,
      status TEXT,
      request_data TEXT,
      execution_status TEXT,
      created_at TEXT,
      reviewed_at TEXT
    );

    CREATE TABLE approval_events (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      approval_request_id INTEGER NOT NULL,
      action TEXT,
      actor_id INTEGER,
      notes TEXT,
      metadata TEXT,
      created_at TEXT
    );

    CREATE TABLE billing_handovers (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      handover_type TEXT,
      handover_amount REAL,
      due_amount REAL,
      handover_by INTEGER,
      handover_to INTEGER,
      received_by INTEGER,
      received_at TEXT,
      receiver_counted_amount REAL,
      receiver_variance REAL,
      admin_verification_status TEXT,
      admin_verified_by INTEGER,
      admin_verified_at TEXT,
      status TEXT,
      created_at TEXT
    );

    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      amount REAL,
      status TEXT,
      approval_status TEXT,
      receipt_status TEXT,
      receipt_key TEXT,
      receipt_url TEXT,
      created_by INTEGER,
      approved_at TEXT,
      created_at TEXT,
      date TEXT,
      description TEXT,
      category TEXT
    );

    CREATE TABLE admin_exception_cases (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      rule_key TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL,
      first_detected_at TEXT NOT NULL,
      resolved_at TEXT,
      snoozed_until TEXT
    );
  `);
  harness.sqlite.exec(collectionMigration);
  harness.sqlite.exec(taskMigration);
  harness.sqlite.exec(`
    INSERT INTO users (id, tenant_id, name) VALUES
      (7, 'tenant-a', 'Task Admin'),
      (8, 'tenant-a', 'Task Owner'),
      (9, 'tenant-a', 'Task Manager'),
      (20, 'tenant-b', 'Private Tenant User');

    INSERT INTO patients (id, tenant_id, name, mobile) VALUES
      (1, 'tenant-a', 'Due Patient', '01700000001'),
      (20, 'tenant-b', 'Private Patient', '01800000020');

    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES
      (900, 'tenant-a', 1, 'INV-900', 100, 0, 100, 'open', '2026-07-01 12:00:00'),
      (920, 'tenant-b', 20, 'INV-920', 999, 0, 999, 'open', '2026-07-01 12:00:00');

    INSERT INTO admin_exception_cases (
      id, tenant_id, rule_key, severity, status, first_detected_at, resolved_at
    ) VALUES
      (44, 'tenant-a', 'billing.high_discount', 'warning', 'resolved',
       '2026-07-01 10:00:00', '2026-07-02 10:00:00'),
      (77, 'tenant-b', 'inventory.low_stock', 'critical', 'open',
       '2026-07-01 10:00:00', NULL);

    INSERT INTO collection_cases (
      id, tenant_id, legacy_bill_id, status, assigned_to, next_followup_at_utc,
      created_at_utc, updated_at_utc
    ) VALUES
      (101, 'tenant-a', 900, 'contacted', 8, '${futureUtc}',
       '2026-07-01T04:00:00.000Z', '2026-07-01T04:00:00.000Z');

    INSERT INTO admin_action_tasks (
      id, tenant_id, title, description, source_type, source_public_id,
      source_href, source_metadata_json, priority, status, assigned_to,
      due_at_utc, completed_by, completed_at_utc, completion_note,
      created_by, created_at_utc, updated_at_utc
    ) VALUES
      (1, 'tenant-a', 'Investigate discount exception', 'Review source evidence.',
       'exception', 'exception-case:44', '/action/exceptions?case=44',
       '{"exceptionCaseId":44}', 'critical', 'open', 7, '${yesterdayUtc}',
       NULL, NULL, NULL, 7, '2026-07-10T04:00:00.000Z', '2026-07-10T04:00:00.000Z'),
      (2, 'tenant-a', 'Prepare daily handoff', NULL,
       'manual', 'manual-task:00000000-0000-4000-8000-000000000002', NULL,
       '{}', 'high', 'in_progress', 7, '${todayUtc}',
       NULL, NULL, NULL, 7, '2026-07-11T04:00:00.000Z', '2026-07-11T04:00:00.000Z'),
      (3, 'tenant-a', 'Follow up collection case', 'Call the patient.',
       'collection', 'collection-case:101', '/action/collections?case=101',
       '{"legacyBillId":900,"collectionCaseId":101}', 'medium', 'open', 8, '${futureUtc}',
       NULL, NULL, NULL, 7, '2026-07-12T04:00:00.000Z', '2026-07-12T04:00:00.000Z'),
      (4, 'tenant-a', 'Review weekly operations', NULL,
       'manual', 'manual-task:00000000-0000-4000-8000-000000000004', NULL,
       '{}', 'low', 'open', NULL, '${futureUtc}',
       NULL, NULL, NULL, 7, '2026-07-13T04:00:00.000Z', '2026-07-13T04:00:00.000Z'),
      (5, 'tenant-a', 'Completed compliance review', NULL,
       'manual', 'manual-task:00000000-0000-4000-8000-000000000005', NULL,
       '{}', 'medium', 'completed', 7, NULL,
       7, '${completedTodayUtc}', 'Evidence archived.', 7,
       '2026-07-13T05:00:00.000Z', '${completedTodayUtc}'),
      (6, 'tenant-a', 'Cancelled duplicate task', NULL,
       'manual', 'manual-task:00000000-0000-4000-8000-000000000006', NULL,
       '{}', 'low', 'cancelled', 7, NULL,
       NULL, NULL, NULL, 7, '2026-07-13T06:00:00.000Z', '2026-07-13T06:00:00.000Z'),
      (20, 'tenant-b', 'Private tenant task', NULL,
       'manual', 'manual-task:00000000-0000-4000-8000-000000000020', NULL,
       '{}', 'critical', 'open', 20, '${yesterdayUtc}',
       NULL, NULL, NULL, 20, '2026-07-10T04:00:00.000Z', '2026-07-10T04:00:00.000Z');

    INSERT INTO admin_action_task_events (
      tenant_id, task_id, event_type, actor_id, old_status, new_status,
      note, metadata_json, created_at_utc
    ) VALUES
      ('tenant-a', 1, 'created', 7, NULL, 'open', NULL,
       '{"sourceType":"exception"}', '2026-07-10T04:00:00.000Z'),
      ('tenant-a', 2, 'started', 8, 'open', 'in_progress', 'Work started.',
       '{}', '2026-07-11T04:00:00.000Z');
  `);
  return harness;
}

function makeApp(options: {
  role?: string;
  tenantId?: string;
  userId?: number;
} = {}) {
  const harness = setupDatabase();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', options.tenantId ?? 'tenant-a');
    c.set('userId', String(options.userId ?? 7));
    if (options.role) c.set('role', options.role as Variables['role']);
    c.env = {
      DB: harness.db,
      ENVIRONMENT: 'test',
      JWT_SECRET: 'test-secret',
    } as Env;
    await next();
  });
  app.route('/action-center', actionCenterRoutes);
  app.route('/admin', adminRoutes);
  app.onError((error, c) => c.json(
    { error: error.message },
    ((error as { status?: number }).status ?? 500) as 400,
  ));
  return { app, harness };
}

async function jsonRequest(
  app: ReturnType<typeof makeApp>['app'],
  path: string,
  method: 'POST' | 'PUT',
  body?: unknown,
) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Action Center persistent task APIs', () => {
  it('enforces operational roles and restricts the team view to management roles', async () => {
    const unauthorised = makeApp();
    expect((await unauthorised.app.request('/action-center/tasks')).status).toBe(403);

    const doctor = makeApp({ role: 'doctor' });
    expect((await doctor.app.request('/action-center/tasks')).status).toBe(403);

    const accountant = makeApp({ role: 'accountant', userId: 7 });
    expect((await accountant.app.request('/action-center/tasks?view=mine')).status).toBe(200);
    expect((await accountant.app.request('/action-center/tasks?view=team')).status).toBe(403);
    expect((await accountant.app.request('/action-center/tasks?view=all')).status).toBe(403);
    expect((await accountant.app.request('/action-center/tasks?view=overdue')).status).toBe(403);
    expect((await accountant.app.request('/action-center/tasks?view=completed')).status).toBe(403);

    const manager = makeApp({ role: 'manager', userId: 9 });
    expect((await manager.app.request('/action-center/tasks?view=team')).status).toBe(200);
  });

  it('keeps non-management detail, creation, and mutations scoped to the current assignee', async () => {
    const accountant = makeApp({ role: 'accountant', userId: 7 });

    expect((await accountant.app.request('/action-center/tasks/1')).status).toBe(200);
    expect((await accountant.app.request('/action-center/tasks/3')).status).toBe(404);
    expect((await accountant.app.request('/action-center/tasks/3/events')).status).toBe(404);
    expect((await jsonRequest(accountant.app, '/action-center/tasks/3/start', 'PUT', {
      note: 'Attempt to start another user task.',
    })).status).toBe(404);
    expect((await jsonRequest(accountant.app, '/action-center/tasks', 'POST', {
      title: 'Assign another user',
      priority: 'medium',
      assignedTo: 8,
    })).status).toBe(403);

    const ownTaskResponse = await jsonRequest(accountant.app, '/action-center/tasks', 'POST', {
      title: 'My own follow-up',
      priority: 'medium',
    });
    const ownTask = await ownTaskResponse.json() as { data: Record<string, unknown> };
    expect(ownTaskResponse.status).toBe(201);
    expect(ownTask.data.assignedTo).toBe(7);
  });

  it('returns tenant-scoped server views, filters, search, and pagination', async () => {
    const { app } = makeApp({ role: 'hospital_admin', userId: 7 });

    const mineResponse = await app.request('/action-center/tasks');
    const mine = await mineResponse.json() as {
      data: { items: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
    };
    expect(mineResponse.status).toBe(200);
    expect(mine.data.items.map((item) => item.id)).toEqual([1, 2]);
    expect(mine.data.items[0]).toEqual(expect.objectContaining({
      title: 'Investigate discount exception',
      priority: 'critical',
      assignedTo: 7,
      assignedToName: 'Task Admin',
      sourceType: 'exception',
      isOverdue: true,
    }));

    const team = await (await app.request('/action-center/tasks?view=team')).json() as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(team.data.items.map((item) => item.id)).toEqual([1, 2, 3, 4]);

    const dueToday = await (await app.request('/action-center/tasks?view=due_today')).json() as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(dueToday.data.items.map((item) => item.id)).toEqual([2]);

    const overdue = await (await app.request('/action-center/tasks?view=overdue')).json() as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(overdue.data.items.map((item) => item.id)).toEqual([1, 2]);

    const completed = await (await app.request('/action-center/tasks?view=completed')).json() as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(completed.data.items.map((item) => item.id)).toEqual([5]);

    const filtered = await (await app.request(
      '/action-center/tasks?view=team&priority=medium&sourceType=collection&search=patient',
    )).json() as { data: { items: Array<Record<string, unknown>> } };
    expect(filtered.data.items.map((item) => item.id)).toEqual([3]);

    const page = await (await app.request('/action-center/tasks?view=team&page=2&limit=2')).json() as {
      data: { items: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
    };
    expect(page.data.items.map((item) => item.id)).toEqual([3, 4]);
    expect(page.data.pagination).toEqual({ page: 2, limit: 2, total: 4, totalPages: 2 });

    const all = await (await app.request('/action-center/tasks?view=all&limit=100')).json() as {
      data: { items: Array<Record<string, unknown>> };
    };
    expect(all.data.items.some((item) => item.id === 20)).toBe(false);
  });

  it('creates validated manual tasks and rejects cross-tenant assignees', async () => {
    const { app } = makeApp({ role: 'hospital_admin', userId: 7 });

    const response = await jsonRequest(app, '/action-center/tasks', 'POST', {
      title: 'Prepare governance report',
      description: 'Summarise the open controls.',
      priority: 'high',
      assignedTo: 8,
      dueAtUtc: laterFutureUtc,
    });
    const body = await response.json() as { data: Record<string, unknown> };
    expect(response.status).toBe(201);
    expect(body.data).toEqual(expect.objectContaining({
      title: 'Prepare governance report',
      sourceType: 'manual',
      priority: 'high',
      status: 'open',
      assignedTo: 8,
      assignedToName: 'Task Owner',
      dueAtUtc: laterFutureUtc,
    }));
    expect(String(body.data.sourcePublicId)).toMatch(/^manual-task:[0-9a-f-]{36}$/);

    expect((await jsonRequest(app, '/action-center/tasks', 'POST', {
      title: ' ',
      priority: 'high',
    })).status).toBe(400);
    expect((await jsonRequest(app, '/action-center/tasks', 'POST', {
      title: 'Invalid timestamp',
      priority: 'medium',
      dueAtUtc: '2026-07-20 10:00:00',
    })).status).toBe(400);
    expect((await jsonRequest(app, '/action-center/tasks', 'POST', {
      title: 'Cross tenant assignment',
      priority: 'medium',
      assignedTo: 20,
    })).status).toBe(422);
  });

  it('returns tenant-safe detail, source status summary, and actor-labelled events', async () => {
    const { app } = makeApp({ role: 'hospital_admin', userId: 7 });

    const detailResponse = await app.request('/action-center/tasks/1');
    const detail = await detailResponse.json() as { data: Record<string, unknown> };
    expect(detailResponse.status).toBe(200);
    expect(detail.data).toEqual(expect.objectContaining({
      id: 1,
      sourceHref: '/action/exceptions?case=44',
      sourceMetadata: { exceptionCaseId: 44 },
      sourceStatusSummary: {
        status: 'resolved',
        severity: 'warning',
        ruleKey: 'billing.high_discount',
      },
    }));

    const eventResponse = await app.request('/action-center/tasks/1/events');
    const events = await eventResponse.json() as { data: Array<Record<string, unknown>> };
    expect(eventResponse.status).toBe(200);
    expect(events.data).toEqual([
      expect.objectContaining({
        eventType: 'created',
        actorId: 7,
        actorName: 'Task Admin',
        metadata: { sourceType: 'exception' },
      }),
    ]);

    expect((await app.request('/action-center/tasks/20')).status).toBe(404);
    expect((await app.request('/action-center/tasks/20/events')).status).toBe(404);
    expect((await app.request('/action-center/tasks/not-a-number')).status).toBe(400);
  });

  it('persists assignment, start, reschedule, and completion with stale-write recovery', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin', userId: 7 });

    const initial = await (await app.request('/action-center/tasks/4')).json() as {
      data: { updatedAtUtc: string };
    };
    const firstTimestamp = initial.data.updatedAtUtc;

    const assignedResponse = await jsonRequest(app, '/action-center/tasks/4/assign', 'PUT', {
      assignedTo: 8,
      note: 'Assign to task owner.',
      expectedUpdatedAtUtc: firstTimestamp,
    });
    const assigned = await assignedResponse.json() as { data: { updatedAtUtc: string } };
    expect(assignedResponse.status).toBe(200);

    const staleResponse = await jsonRequest(app, '/action-center/tasks/4/start', 'PUT', {
      expectedUpdatedAtUtc: firstTimestamp,
      note: 'Stale start.',
    });
    expect(staleResponse.status).toBe(409);

    const startedResponse = await jsonRequest(app, '/action-center/tasks/4/start', 'PUT', {
      expectedUpdatedAtUtc: assigned.data.updatedAtUtc,
      note: 'Work started.',
    });
    const started = await startedResponse.json() as { data: { updatedAtUtc: string } };
    expect(startedResponse.status).toBe(200);

    const rescheduledResponse = await jsonRequest(app, '/action-center/tasks/4/reschedule', 'PUT', {
      dueAtUtc: laterFutureUtc,
      note: 'Awaiting the weekly pack.',
      expectedUpdatedAtUtc: started.data.updatedAtUtc,
    });
    const rescheduled = await rescheduledResponse.json() as { data: { updatedAtUtc: string } };
    expect(rescheduledResponse.status).toBe(200);

    const completedResponse = await jsonRequest(app, '/action-center/tasks/4/complete', 'PUT', {
      note: 'Weekly pack reviewed and archived.',
      expectedUpdatedAtUtc: rescheduled.data.updatedAtUtc,
    });
    const completed = await completedResponse.json() as { data: Record<string, unknown> };
    expect(completedResponse.status).toBe(200);
    expect(completed.data).toEqual(expect.objectContaining({
      status: 'completed',
      assignedTo: 8,
      completionNote: 'Weekly pack reviewed and archived.',
      completedBy: 7,
    }));

    expect((await jsonRequest(app, '/action-center/tasks/4/start', 'PUT', {
      note: 'Cannot restart terminal task.',
    })).status).toBe(409);
    expect((await jsonRequest(app, '/action-center/tasks/3/assign', 'PUT', {
      assignedTo: 20,
    })).status).toBe(422);
    expect((await jsonRequest(app, '/action-center/tasks/999/complete', 'PUT', {
      note: 'Missing task.',
    })).status).toBe(404);
    expect((await jsonRequest(app, '/action-center/tasks/3/complete', 'PUT', {
      note: ' ',
    })).status).toBe(400);

    const eventTypes = harness.sqlite.prepare(`
      SELECT event_type
      FROM admin_action_task_events
      WHERE tenant_id = 'tenant-a' AND task_id = 4
      ORDER BY id
    `).all() as Array<{ event_type: string }>;
    expect(eventTypes.map((row) => row.event_type)).toEqual([
      'assigned',
      'started',
      'rescheduled',
      'completed',
    ]);
  });

  it('keeps non-management next-best-action links inside the accessible mine view', async () => {
    const { app } = makeApp({ role: 'accountant', userId: 7 });

    const response = await app.request('/action-center/summary');
    const body = await response.json() as {
      data: { nextBestAction: Record<string, unknown> | null };
    };

    expect(response.status).toBe(200);
    expect(body.data.nextBestAction).toEqual({
      workstream: 'tasks',
      href: '/action/tasks?view=mine',
      label: 'Review my overdue tasks',
      priority: 'high',
    });
  });

  it('exposes persistent task counts and prioritises overdue task work', async () => {
    const { app } = makeApp({ role: 'hospital_admin', userId: 7 });

    const response = await app.request('/action-center/summary');
    const body = await response.json() as {
      data: {
        tasks: Record<string, unknown>;
        capabilities: Record<string, boolean>;
        nextBestAction: Record<string, unknown> | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.tasks).toEqual({
      open: 4,
      overdue: 2,
      assignedToMe: 2,
    });
    expect(body.data.capabilities.persistentTasks).toBe(true);
    expect(body.data.nextBestAction).toEqual({
      workstream: 'tasks',
      href: '/action/tasks?view=overdue',
      label: 'Review overdue tasks',
      priority: 'high',
    });
  });

  it('serves the legacy admin endpoint from persistent tasks without regenerating source cards', async () => {
    const { app } = makeApp({ role: 'hospital_admin', userId: 7 });

    const response = await app.request('/admin/tasks');
    const body = await response.json() as {
      tasks: Array<Record<string, unknown>>;
      summary: Record<string, unknown>;
    };

    expect(response.status).toBe(200);
    expect(body.tasks).toHaveLength(5);
    expect(body.tasks.some((task) => task.id === 'due-900')).toBe(false);
    expect(body.tasks.some((task) => task.title === 'Follow up collection case')).toBe(true);
    expect(body.tasks[0]).toEqual(expect.objectContaining({
      id: '1',
      title: 'Investigate discount exception',
      assignee: 'Task Admin',
      priority: 'critical',
      module: 'exception',
      status: 'overdue',
    }));
    expect(body.summary).toEqual({
      total: 5,
      pending: 3,
      inProgress: 1,
      completed: 1,
      overdue: 2,
    });
  });
});
