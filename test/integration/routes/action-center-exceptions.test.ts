import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import actionCenterRoutes from '../../../src/routes/tenant/actionCenter';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

const migrationSql = readFileSync('migrations/0500_admin_exception_cases.sql', 'utf8');

function setupDatabase() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(migrationSql);
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE billing_handovers (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      handover_by INTEGER,
      handover_amount REAL,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT,
      total REAL DEFAULT 0,
      due REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax_total REAL DEFAULT 0,
      discount_by_name TEXT,
      created_by INTEGER,
      cancelled_by INTEGER,
      cancel_reason TEXT,
      cancelled_at TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      quantity REAL,
      unit_price REAL
    );
    CREATE TABLE medicines (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      name TEXT,
      quantity REAL
    );
    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT,
      entity_id INTEGER,
      requested_by INTEGER,
      request_data TEXT,
      status TEXT,
      created_at TEXT
    );
    CREATE TABLE approval_events (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      request_id INTEGER,
      action TEXT,
      created_at TEXT
    );
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      amount REAL,
      status TEXT,
      created_at TEXT
    );
  `);
  harness.sqlite.prepare(`INSERT INTO users (id, tenant_id, name) VALUES (?, ?, ?)`).run(77, 'tenant-a', 'Admin User');
  harness.sqlite.prepare(`INSERT INTO users (id, tenant_id, name) VALUES (?, ?, ?)`).run(88, 'tenant-a', 'Cash Supervisor');
  harness.sqlite.prepare(`INSERT INTO users (id, tenant_id, name) VALUES (?, ?, ?)`).run(99, 'tenant-b', 'Other Tenant User');
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
    c.set('userId', String(options.userId ?? 77));
    if (options.role) c.set('role', options.role as Variables['role']);
    c.env = {
      DB: harness.db,
      ENVIRONMENT: 'test',
      JWT_SECRET: 'test-secret',
    } as Env;
    await next();
  });
  app.route('/action-center', actionCenterRoutes);
  app.onError((error, c) => c.json({ error: error.message }, (error as { status?: number }).status ?? 500));
  return { app, harness };
}

function seedCase(
  harness: ReturnType<typeof setupDatabase>,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const row = {
    tenant_id: 'tenant-a',
    rule_key: 'cash.stale_handover',
    fingerprint: `handover:${overrides.source_id ?? 42}`,
    source_type: 'cash_handover',
    source_id: String(overrides.source_id ?? 42),
    module: 'cash',
    severity: 'warning',
    title: 'Stale cash handover',
    description: 'Pending handover is older than 24 hours.',
    source_href: '/cash/handover/42',
    status: 'open',
    assigned_to: null,
    first_detected_at: '2026-07-13 08:00:00',
    last_detected_at: '2026-07-14 09:00:00',
    snoozed_until: null,
    metadata_json: '{}',
    created_at: '2026-07-13 08:00:00',
    updated_at: '2026-07-14 09:00:00',
    ...overrides,
  };
  const result = harness.sqlite.prepare(`
    INSERT INTO admin_exception_cases (
      tenant_id, rule_key, fingerprint, source_type, source_id, module,
      severity, title, description, source_href, status, assigned_to,
      first_detected_at, last_detected_at, snoozed_until, metadata_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.tenant_id,
    row.rule_key,
    row.fingerprint,
    row.source_type,
    row.source_id,
    row.module,
    row.severity,
    row.title,
    row.description,
    row.source_href,
    row.status,
    row.assigned_to,
    row.first_detected_at,
    row.last_detected_at,
    row.snoozed_until,
    row.metadata_json,
    row.created_at,
    row.updated_at,
  );
  return Number(result.lastInsertRowid);
}

async function jsonRequest(app: ReturnType<typeof makeApp>['app'], path: string, method: 'POST' | 'PUT', body?: unknown) {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('Action Center exception APIs', () => {
  it('rejects readers without an authorised role', async () => {
    const { app } = makeApp();
    const response = await app.request('/action-center/exceptions');
    expect(response.status).toBe(403);
  });

  it('rejects operational roles that are not permitted to manage exception cases', async () => {
    const { app } = makeApp({ role: 'doctor' });
    const response = await app.request('/action-center/exceptions');
    expect(response.status).toBe(403);
  });

  it('filters and paginates tenant-scoped cases before response mapping', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    seedCase(harness, { source_id: 1, fingerprint: 'handover:1', title: 'Stale alpha', updated_at: '2026-07-14 09:00:00' });
    seedCase(harness, { source_id: 2, fingerprint: 'handover:2', title: 'Stale beta', updated_at: '2026-07-14 10:00:00' });
    seedCase(harness, { tenant_id: 'tenant-b', source_id: 3, fingerprint: 'handover:3', title: 'Stale other tenant' });
    seedCase(harness, { source_id: 4, fingerprint: 'handover:4', severity: 'critical', title: 'Critical stale' });

    const response = await app.request(
      '/action-center/exceptions?status=all&severity=warning&type=cash.stale_handover&search=stale&page=2&limit=1',
    );
    const body = await response.json() as {
      data: {
        items: Array<Record<string, unknown>>;
        pagination: { page: number; limit: number; total: number; totalPages: number };
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.pagination).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]).not.toHaveProperty('tenantId');
    expect(body.data.items[0]).toEqual(expect.objectContaining({
      title: 'Stale alpha',
      ruleKey: 'cash.stale_handover',
      sourceHref: '/cash/handover/42',
    }));
  });

  it('returns active work across open, acknowledged, in-progress, and expired snoozed states', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    seedCase(harness, { source_id: 11, fingerprint: 'handover:11', status: 'open' });
    seedCase(harness, { source_id: 12, fingerprint: 'handover:12', status: 'acknowledged' });
    seedCase(harness, { source_id: 13, fingerprint: 'handover:13', status: 'in_progress' });
    seedCase(harness, {
      source_id: 14,
      fingerprint: 'handover:14',
      status: 'snoozed',
      snoozed_until: '2000-01-01 00:00:00',
    });
    seedCase(harness, {
      source_id: 15,
      fingerprint: 'handover:15',
      status: 'snoozed',
      snoozed_until: '2099-01-01 00:00:00',
    });
    seedCase(harness, { source_id: 16, fingerprint: 'handover:16', status: 'resolved' });

    const response = await app.request('/action-center/exceptions?status=active&limit=100');
    const body = await response.json() as {
      data: { items: Array<{ sourceId: string; status: string }>; pagination: { total: number } };
    };

    expect(response.status).toBe(200);
    expect(body.data.pagination.total).toBe(4);
    expect(body.data.items.map((item) => Number(item.sourceId)).sort((a, b) => a - b)).toEqual([11, 12, 13, 14]);
  });

  it('returns detail and timeline actor names without exposing another tenant case', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    const id = seedCase(harness, { assigned_to: 88 });
    harness.sqlite.prepare(`
      INSERT INTO admin_exception_events (
        tenant_id, case_id, event_type, actor_id, old_status, new_status, note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('tenant-a', id, 'acknowledged', 77, 'open', 'acknowledged', 'Reviewed', '2026-07-14 10:00:00');
    const otherTenantId = seedCase(harness, { tenant_id: 'tenant-b', fingerprint: 'handover:other' });

    const detailResponse = await app.request(`/action-center/exceptions/${id}`);
    const detail = await detailResponse.json() as { data: Record<string, unknown> };
    expect(detailResponse.status).toBe(200);
    expect(detail.data).toEqual(expect.objectContaining({
      id,
      assignedTo: 88,
      assignedToName: 'Cash Supervisor',
      sourceHref: '/cash/handover/42',
    }));

    const eventResponse = await app.request(`/action-center/exceptions/${id}/events`);
    const events = await eventResponse.json() as { data: Array<Record<string, unknown>> };
    expect(eventResponse.status).toBe(200);
    expect(events.data).toEqual([
      expect.objectContaining({ actorId: 77, actorName: 'Admin User', eventType: 'acknowledged' }),
    ]);

    const hiddenResponse = await app.request(`/action-center/exceptions/${otherTenantId}`);
    expect(hiddenResponse.status).toBe(404);
  });

  it('validates list and transition inputs with 400 responses', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    const id = seedCase(harness);

    expect((await app.request('/action-center/exceptions?limit=101')).status).toBe(400);
    expect((await jsonRequest(app, `/action-center/exceptions/${id}/dismiss`, 'PUT', { reason: ' ' })).status).toBe(400);
    expect((await jsonRequest(app, `/action-center/exceptions/${id}/assign`, 'PUT', { assignedTo: 0 })).status).toBe(400);
    expect((await jsonRequest(app, `/action-center/exceptions/${id}/assign`, 'PUT', { assignedTo: 99 })).status).toBe(400);
    expect((await jsonRequest(app, `/action-center/exceptions/${id}/assign`, 'PUT', { assignedTo: 999 })).status).toBe(400);
  });

  it('returns 404 for absent transitions and 409 for invalid state transitions', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    const id = seedCase(harness, { status: 'resolved' });

    expect((await jsonRequest(app, '/action-center/exceptions/999/acknowledge', 'PUT', {})).status).toBe(404);
    expect((await jsonRequest(app, `/action-center/exceptions/${id}/start`, 'PUT', {})).status).toBe(409);
  });

  it('persists valid actions and timeline events', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin', userId: 77 });
    const id = seedCase(harness);

    const response = await jsonRequest(app, `/action-center/exceptions/${id}/acknowledge`, 'PUT', { note: 'Reviewed' });
    const body = await response.json() as { data: { status: string } };

    expect(response.status).toBe(200);
    expect(body.data.status).toBe('acknowledged');
    expect(harness.sqlite.prepare(`SELECT status FROM admin_exception_cases WHERE id = ?`).get(id)).toEqual({ status: 'acknowledged' });
    expect(harness.sqlite.prepare(`SELECT event_type FROM admin_exception_events WHERE case_id = ?`).get(id)).toEqual({ event_type: 'acknowledged' });
  });

  it('runs detector synchronization through the explicit sync endpoint', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    harness.sqlite.prepare(`
      INSERT INTO billing_handovers (id, tenant_id, handover_by, handover_amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(42, 'tenant-a', 77, 0, 'pending', '2026-07-12 08:00:00');

    const response = await jsonRequest(app, '/action-center/exceptions/sync', 'POST');
    const body = await response.json() as { data: { observed: number; created: number } };

    expect(response.status).toBe(200);
    expect(body.data.observed).toBeGreaterThanOrEqual(1);
    expect(body.data.created).toBeGreaterThanOrEqual(1);
    expect(harness.sqlite.prepare(`SELECT COUNT(*) AS count FROM admin_exception_cases WHERE tenant_id = ?`).get('tenant-a')).toEqual({ count: 1 });
  });
});
