import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import actionCenterRoutes from '../../../src/routes/tenant/actionCenter';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

const providerReviewsMigration = readFileSync('migrations/0121_provider_reviews.sql', 'utf8');
const approvalMigrations = [
  '0279_approval_billing_shift_tables.sql',
  '0380_expand_approval_request_types.sql',
  '0381_create_approval_events.sql',
  '0382_approval_execution_lock.sql',
  '0516_two_person_approval_policy.sql',
  '0526_receivable_write_off_approval.sql',
].map((filename) => readFileSync(`migrations/${filename}`, 'utf8'));
const collectionMigration = readFileSync('migrations/0501_collection_cases.sql', 'utf8');
const taskMigration = readFileSync('migrations/0503_action_tasks_review_moderation.sql', 'utf8');

function setupDatabase() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
    CREATE TABLE users (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      PRIMARY KEY (tenant_id, id)
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
  harness.sqlite.exec(providerReviewsMigration);
  for (const migration of approvalMigrations) harness.sqlite.exec(migration);
  harness.sqlite.exec(collectionMigration);
  harness.sqlite.exec(taskMigration);
  harness.sqlite.exec(`
    INSERT INTO users (id, tenant_id, name) VALUES
      (7, 'tenant-a', 'Collection Admin'),
      (8, 'tenant-a', 'Collection Supervisor'),
      (20, 'tenant-b', 'Private Tenant B User');

    INSERT INTO patients (id, tenant_id, name, mobile) VALUES
      (1, 'tenant-a', 'Alice Patient', '01700000001'),
      (2, 'tenant-a', 'Bob Patient', '01700000002'),
      (3, 'tenant-a', 'Carol Patient', '01700000003'),
      (20, 'tenant-b', 'Private Tenant B Patient', '01800000020');

    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES
      (101, 'tenant-a', 1, 'INV-101', 100, 20, 80, 'open', '2026-07-14 12:00:00'),
      (102, 'tenant-a', 2, 'INV-102', 50, 0, 50, 'open', '2026-06-10 12:00:00'),
      (103, 'tenant-a', 3, 'INV-103', 30, 0, 30, 'open', '2026-04-01 12:00:00'),
      (104, 'tenant-a', 1, 'INV-PAID', 40, 40, 0, 'paid', '2026-07-14 12:00:00'),
      (201, 'tenant-b', 20, 'INV-B-201', 999, 0, 999, 'open', '2026-07-14 12:00:00');

    INSERT INTO collection_cases (
      tenant_id, legacy_bill_id, status, assigned_to, next_followup_at_utc,
      promise_date, promise_amount_minor, currency_code, latest_note,
      created_at_utc, updated_at_utc
    ) VALUES
      ('tenant-a', 102, 'promised', 7, '2000-01-01T00:00:00.000Z',
       '2026-07-20', 2500, 'BDT', 'Promise recorded',
       '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z'),
      ('tenant-a', 103, 'disputed', 8, NULL,
       NULL, NULL, NULL, 'Patient disputes the invoice',
       '2026-07-14T06:00:00.000Z', '2026-07-14T06:00:00.000Z');
  `);
  return harness;
}

function makeApp(options: {
  role?: string;
  tenantId?: string;
  userId?: number;
  setup?: (harness: ReturnType<typeof setupDatabase>) => void;
} = {}) {
  const harness = setupDatabase();
  options.setup?.(harness);
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

describe('Action Center collection APIs', () => {
  it('rejects readers without an authorised operational role', async () => {
    const { app } = makeApp();
    expect((await app.request('/action-center/collections')).status).toBe(403);

    const doctor = makeApp({ role: 'doctor' });
    expect((await doctor.app.request('/action-center/collections')).status).toBe(403);
  });

  it('enforces tenant and user permission overrides for collection reads and workflow actions', async () => {
    const readRevoked = makeApp({
      role: 'manager',
      setup: ({ sqlite }) => {
        sqlite.prepare(`
          INSERT INTO role_permission_overrides (tenant_id, role, permissions)
          VALUES (?, ?, ?)
        `).run('tenant-a', 'manager', JSON.stringify(['receivables.followup.manage']));
      },
    });
    const readResponse = await readRevoked.app.request('/action-center/collections');
    expect(readResponse.status).toBe(403);
    await expect(readResponse.json()).resolves.toMatchObject({
      error: 'Missing permission: receivables.view',
    });
    const summaryResponse = await readRevoked.app.request('/action-center/summary');
    expect(summaryResponse.status).toBe(403);
    await expect(summaryResponse.json()).resolves.toMatchObject({
      error: 'Missing permission: receivables.view',
    });

    const followupRevoked = makeApp({
      role: 'manager',
      setup: ({ sqlite }) => {
        sqlite.prepare(`
          INSERT INTO user_permission_overrides (tenant_id, user_id, permission, action)
          VALUES (?, ?, ?, ?)
        `).run('tenant-a', '7', 'receivables.followup.manage', 'revoke');
      },
    });
    const followupResponse = await jsonRequest(
      followupRevoked.app,
      '/action-center/collections/invoice/legacy-bill%3A101/follow-up',
      'PUT',
      { nextFollowupAtUtc: '2026-07-25T06:00:00.000Z', note: 'Permission override check.' },
    );
    expect(followupResponse.status).toBe(403);
    await expect(followupResponse.json()).resolves.toMatchObject({
      error: 'Missing permission: receivables.followup.manage',
    });
  });

  it('returns a paginated active queue and full-dataset minor-unit summary', async () => {
    const { app } = makeApp({ role: 'hospital_admin' });

    const response = await app.request(
      '/action-center/collections?status=active&sort=exposure&page=1&limit=2',
    );
    const body = await response.json() as {
      data: {
        items: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
        pagination: Record<string, unknown>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.items).toHaveLength(2);
    expect(body.data.items.map((item) => item.invoiceNumber)).toEqual(['INV-101', 'INV-102']);
    expect(body.data.items[0]).toEqual(expect.objectContaining({
      sourceKey: 'legacy-bill:101',
      source: { sourceType: 'invoice', legacyBillId: 101 },
      dueMinor: 8000,
      currencyCode: 'BDT',
      collectionStatus: 'new',
    }));
    expect(body.data.pagination).toEqual({ page: 1, limit: 2, total: 3, totalPages: 2 });
    expect(body.data.summary).toEqual(expect.objectContaining({
      totalDueMinor: 16000,
      totalInvoices: 3,
      followupDue: 1,
      promisedAmountMinor: 2500,
      disputedAmountMinor: 3000,
      currencyCode: 'BDT',
      supportedSourceTypes: ['invoice'],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
      amountsByCurrency: [expect.objectContaining({
        currencyCode: 'BDT',
        totalDueMinor: 16000,
        totalInvoices: 3,
      })],
    }));
  });

  it('uses the canonical collection aggregate in the top-level Action Center summary', async () => {
    const { app } = makeApp({ role: 'hospital_admin' });

    const response = await app.request('/action-center/summary');
    const body = await response.json() as {
      data: {
        collections: Record<string, unknown>;
        capabilities: Record<string, boolean>;
        nextBestAction: Record<string, unknown> | null;
      };
    };

    expect(response.status).toBe(200);
    expect(body.data.collections).toEqual({
      open: 3,
      followupDue: 1,
      exposure: 160,
      exposureMinor: 16000,
      currencyCode: 'BDT',
      amountsByCurrency: [expect.objectContaining({
        currencyCode: 'BDT',
        totalDueMinor: 16000,
        totalInvoices: 3,
      })],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
    });
    expect(body.data.capabilities.persistentCollections).toBe(true);
    expect(body.data.nextBestAction).toEqual(expect.objectContaining({
      workstream: 'collections',
      href: '/action/collections?followup=due&status=active',
    }));
  });

  it('returns the same filtered summary without fetching a visible page', async () => {
    const { app } = makeApp({ role: 'hospital_admin' });

    const response = await app.request(
      '/action-center/collections/summary?status=promised&assignee=7&followup=due',
    );
    const body = await response.json() as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.data).toEqual(expect.objectContaining({
      totalDueMinor: 5000,
      totalInvoices: 1,
      followupDue: 1,
      promisedAmountMinor: 2500,
      authorityMode: 'legacy',
    }));
  });

  it('returns tenant-scoped invoice detail, payment capability, and actor timeline', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });
    const caseRow = harness.sqlite.prepare(`
      SELECT id FROM collection_cases
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 102
    `).get() as { id: number };
    harness.sqlite.prepare(`
      INSERT INTO collection_case_events (
        tenant_id, case_id, event_type, actor_id, old_status, new_status,
        note, metadata_json, created_at_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'tenant-a',
      caseRow.id,
      'promise_recorded',
      7,
      'contacted',
      'promised',
      'Promise recorded',
      JSON.stringify({ promiseAmountMinor: 2500, currencyCode: 'BDT' }),
      '2026-07-14T06:00:00.000Z',
    );

    const detailResponse = await app.request('/action-center/collections/invoice/legacy-bill:102');
    const detail = await detailResponse.json() as { data: Record<string, unknown> };
    expect(detailResponse.status).toBe(200);
    expect(detail.data).toEqual(expect.objectContaining({
      sourceKey: 'legacy-bill:102',
      source: { sourceType: 'invoice', legacyBillId: 102 },
      invoiceNumber: 'INV-102',
      patientName: 'Bob Patient',
      dueMinor: 5000,
      collectionStatus: 'promised',
      assignedTo: 7,
      assignedToName: 'Collection Admin',
      paymentHref: '/billing?collectBillId=102',
      paymentCapability: 'available',
      authorityMode: 'legacy',
    }));

    const eventsResponse = await app.request(
      '/action-center/collections/invoice/legacy-bill:102/events',
    );
    const events = await eventsResponse.json() as { data: Array<Record<string, unknown>> };
    expect(eventsResponse.status).toBe(200);
    expect(events.data).toEqual([
      expect.objectContaining({
        eventType: 'promise_recorded',
        actorId: 7,
        actorName: 'Collection Admin',
        metadata: { promiseAmountMinor: 2500, currencyCode: 'BDT' },
      }),
    ]);

    expect((await app.request('/action-center/collections/invoice/legacy-bill:201')).status).toBe(404);
    expect((await app.request('/action-center/collections/invoice/legacy-bill:201/events')).status).toBe(404);
  });

  it('creates a permission-protected controlled write-off request from a collection source', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin', userId: 7 });

    const response = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/write-off-request',
      'POST',
      {
        amountMinor: 3000,
        currencyCode: 'BDT',
        reasonCode: 'uncollectible',
        note: 'Repeated documented follow-ups did not produce a recoverable payment.',
        evidenceUrls: ['https://evidence.example/write-off/api-101'],
      },
    );
    const body = await response.json() as { data: { approvalId: number; collectionCaseId: number } };

    expect(response.status).toBe(201);
    expect(body.data).toEqual({ approvalId: expect.any(Number), collectionCaseId: expect.any(Number) });
    expect(harness.sqlite.prepare(`
      SELECT type, entity_id, entity_no, requested_by, status, execution_status, request_data
      FROM approval_requests WHERE id=?
    `).get(body.data.approvalId)).toMatchObject({
      type: 'receivable_write_off',
      entity_id: body.data.collectionCaseId,
      entity_no: 'INV-101',
      requested_by: 7,
      status: 'pending',
      execution_status: 'pending',
    });
    expect(harness.sqlite.prepare(`
      SELECT status FROM collection_cases WHERE id=?
    `).get(body.data.collectionCaseId)).toEqual({ status: 'write_off_requested' });
  });

  it('enforces request permission overrides and rejects invalid or duplicate requests', async () => {
    const revoked = makeApp({
      role: 'manager',
      userId: 8,
      setup: (harness) => {
        harness.sqlite.prepare(`
          INSERT INTO user_permission_overrides (tenant_id, user_id, permission, action)
          VALUES ('tenant-a', '8', 'receivables.write_off.request', 'revoke')
        `).run();
      },
    });
    const revokedResponse = await jsonRequest(
      revoked.app,
      '/action-center/collections/invoice/legacy-bill:101/write-off-request',
      'POST',
      {
        amountMinor: 3000,
        currencyCode: 'BDT',
        reasonCode: 'uncollectible',
        note: 'This request must be rejected by the server permission check.',
      },
    );
    expect(revokedResponse.status).toBe(403);

    const { app } = makeApp({ role: 'hospital_admin', userId: 7 });
    const invalid = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/write-off-request',
      'POST',
      {
        amountMinor: 0,
        currencyCode: 'bdt',
        reasonCode: 'routine_discount',
        note: 'short',
      },
    );
    expect(invalid.status).toBe(400);

    const payload = {
      amountMinor: 3000,
      currencyCode: 'BDT',
      reasonCode: 'uncollectible',
      note: 'Repeated documented follow-ups did not produce a recoverable payment.',
    };
    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/write-off-request',
      'POST',
      payload,
    )).status).toBe(201);
    const duplicate = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/write-off-request',
      'POST',
      payload,
    );
    expect(duplicate.status).toBe(409);
    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:201/write-off-request',
      'POST',
      payload,
    )).status).toBe(404);
  });

  it('returns a server-backed write-off request capability in collection detail', async () => {
    const admin = makeApp({ role: 'hospital_admin', userId: 7 });
    const available = await admin.app.request('/action-center/collections/invoice/legacy-bill:101');
    await expect(available.json()).resolves.toMatchObject({
      data: { writeOffRequestCapability: 'available' },
    });

    const revoked = makeApp({
      role: 'manager',
      userId: 8,
      setup: (harness) => {
        harness.sqlite.prepare(`
          INSERT INTO user_permission_overrides (tenant_id, user_id, permission, action)
          VALUES ('tenant-a', '8', 'receivables.write_off.request', 'revoke')
        `).run();
      },
    });
    const forbidden = await revoked.app.request('/action-center/collections/invoice/legacy-bill:101');
    await expect(forbidden.json()).resolves.toMatchObject({
      data: { writeOffRequestCapability: 'forbidden' },
    });
  });

  it('keeps canonical detail readable but disables and rejects write-off when command schema is incomplete', async () => {
    const { app } = makeApp({
      role: 'hospital_admin',
      userId: 7,
      setup: (harness) => {
        harness.sqlite.exec(`
          CREATE TABLE canonical_feature_flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            flag_key TEXT NOT NULL,
            domain TEXT NOT NULL,
            mode TEXT NOT NULL,
            is_enabled INTEGER NOT NULL,
            UNIQUE(tenant_id, flag_key)
          );
          CREATE TABLE canonical_invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            invoice_public_id TEXT NOT NULL,
            invoice_number TEXT NOT NULL,
            legacy_patient_id INTEGER NOT NULL,
            currency_code TEXT NOT NULL,
            total_minor INTEGER NOT NULL,
            paid_minor INTEGER NOT NULL,
            due_minor INTEGER NOT NULL,
            credited_minor INTEGER NOT NULL,
            net_due_minor INTEGER NOT NULL,
            status TEXT NOT NULL,
            issued_at_utc TEXT NOT NULL,
            UNIQUE(tenant_id, invoice_public_id)
          );
          INSERT INTO canonical_feature_flags (
            tenant_id, flag_key, domain, mode, is_enabled
          ) VALUES ('tenant-a', 'billing.receivables', 'billing', 'canonical', 1);
          INSERT INTO canonical_invoices (
            tenant_id, invoice_public_id, invoice_number, legacy_patient_id,
            currency_code, total_minor, paid_minor, due_minor, credited_minor,
            net_due_minor, status, issued_at_utc
          ) VALUES (
            'tenant-a', 'cinv-command-missing', 'CINV-COMMAND-MISSING', 1,
            'BDT', 10000, 2000, 8000, 0, 8000, 'posted', '2026-07-20T04:00:00.000Z'
          );
        `);
      },
    });

    const detail = await app.request('/action-center/collections/invoice/canonical-invoice:cinv-command-missing');
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: {
        invoiceNumber: 'CINV-COMMAND-MISSING',
        dueMinor: 8000,
        writeOffRequestCapability: 'unavailable',
      },
    });

    const request = await jsonRequest(
      app,
      '/action-center/collections/invoice/canonical-invoice:cinv-command-missing/write-off-request',
      'POST',
      {
        amountMinor: 3000,
        currencyCode: 'BDT',
        reasonCode: 'uncollectible',
        note: 'Canonical command tables must exist before accepting this request.',
      },
    );
    expect(request.status).toBe(503);
    await expect(request.json()).resolves.toMatchObject({
      code: 'RECEIVABLE_AUTHORITY_UNAVAILABLE',
      requestedMode: 'canonical',
      missingRequirements: expect.arrayContaining([
        'canonical_source_mappings',
        'canonical_outbox_events',
        'canonical_credit_notes',
        'canonical_credit_note_lines',
        'canonical_compensation_accruals',
      ]),
    });
  });

  it('forwards authenticated actor evidence when detail reconciliation settles a linked task', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin', userId: 7 });
    harness.sqlite.prepare(`
      INSERT INTO collection_cases (
        tenant_id, legacy_bill_id, status, assigned_to,
        created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'contact_due', ?, ?, ?)
    `).run(
      'tenant-a',
      104,
      7,
      '2026-07-15T03:00:00.000Z',
      '2026-07-15T03:00:00.000Z',
    );
    const caseId = Number((harness.sqlite.prepare(`
      SELECT id
      FROM collection_cases
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 104
    `).get() as { id: number }).id);
    harness.sqlite.prepare(`
      INSERT INTO admin_action_tasks (
        tenant_id, title, source_type, source_public_id, source_href,
        source_metadata_json, priority, status, assigned_to, due_at_utc,
        created_by, created_at_utc, updated_at_utc
      ) VALUES (?, ?, 'collection', ?, ?, ?, 'medium', 'open', ?, ?, ?, ?, ?)
    `).run(
      'tenant-a',
      'Follow up collection INV-PAID',
      `collection-case:${caseId}`,
      `/action/collections?case=${caseId}`,
      JSON.stringify({ legacyBillId: 104, collectionCaseId: caseId }),
      7,
      '2026-07-20T04:00:00.000Z',
      7,
      '2026-07-15T03:00:00.000Z',
      '2026-07-15T03:00:00.000Z',
    );

    const response = await app.request('/action-center/collections/invoice/legacy-bill:104');
    const body = await response.json() as { data: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(body.data).toEqual(expect.objectContaining({
      collectionStatus: 'closed',
      dueMinor: 0,
    }));
    expect(harness.sqlite.prepare(`
      SELECT status, completed_by, completion_note
      FROM admin_action_tasks
      WHERE tenant_id = 'tenant-a' AND source_public_id = ?
    `).get(`collection-case:${caseId}`)).toEqual({
      status: 'completed',
      completed_by: 7,
      completion_note: 'Collection source paid.',
    });
  });

  it('validates query, source keys, timestamps, and minor-unit request bodies', async () => {
    const { app } = makeApp({ role: 'hospital_admin' });

    expect((await app.request('/action-center/collections?limit=101')).status).toBe(400);
    expect((await app.request('/action-center/collections?minAmountMinor=12.5')).status).toBe(400);
    expect((await app.request('/action-center/collections/invoice/not-a-source')).status).toBe(400);
    expect((await app.request('/action-center/collections/invoice/legacy-bill:0')).status).toBe(400);
    expect((await app.request('/action-center/collections/invoice/canonical-invoice:%2Funsafe')).status).toBe(400);

    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/follow-up',
      'PUT',
      { nextFollowupAtUtc: '2026-07-20 10:00:00' },
    )).status).toBe(400);
    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/promise',
      'PUT',
      {
        promiseDate: '2026-07-20',
        promiseAmountMinor: 100.5,
        currencyCode: 'BDT',
        note: 'Invalid fractional minor unit.',
      },
    )).status).toBe(400);
  });

  it('persists lifecycle actions and exposes append-only events', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin', userId: 7 });

    const contactResponse = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/contact',
      'POST',
      {
        channel: 'phone',
        outcome: 'Patient answered',
        note: 'Discussed the invoice.',
        nextFollowupAtUtc: '2099-07-20T04:00:00.000Z',
      },
    );
    const contact = await contactResponse.json() as { data: { updatedAtUtc: string } };
    expect(contactResponse.status).toBe(200);

    const promiseResponse = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/promise',
      'PUT',
      {
        promiseDate: '2099-07-22',
        promiseAmountMinor: 5000,
        currencyCode: 'BDT',
        note: 'Patient committed to pay.',
        expectedUpdatedAtUtc: contact.data.updatedAtUtc,
      },
    );
    expect(promiseResponse.status).toBe(200);

    const disputeResponse = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/dispute',
      'PUT',
      {
        reason: 'Service amount questioned',
        note: 'Escalate after invoice review.',
      },
    );
    expect(disputeResponse.status).toBe(200);

    const escalateResponse = await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/escalate',
      'PUT',
      {
        reason: 'Requires supervisor review',
        note: 'Assigning to collection supervisor.',
        assignedTo: 8,
      },
    );
    const escalated = await escalateResponse.json() as { data: Record<string, unknown> };
    expect(escalateResponse.status).toBe(200);
    expect(escalated.data).toEqual(expect.objectContaining({
      collectionStatus: 'escalated',
      assignedTo: 8,
      assignedToName: 'Collection Supervisor',
    }));

    expect(harness.sqlite.prepare(`
      SELECT status, assigned_to, promise_amount_minor, currency_code
      FROM collection_cases
      WHERE tenant_id = 'tenant-a' AND legacy_bill_id = 101
    `).get()).toEqual({
      status: 'escalated',
      assigned_to: 8,
      promise_amount_minor: 5000,
      currency_code: 'BDT',
    });
    expect(harness.sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM collection_case_events
      WHERE tenant_id = 'tenant-a'
    `).get()).toEqual({ count: 4 });
  });

  it('returns 404, 409, and 422 without leaking source state', async () => {
    const { app, harness } = makeApp({ role: 'hospital_admin' });

    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:999/contact',
      'POST',
      { channel: 'phone', outcome: 'Answered', note: 'Absent source.' },
    )).status).toBe(404);

    harness.sqlite.exec(`
      UPDATE bills SET due = 0, paid = total, status = 'paid'
      WHERE tenant_id = 'tenant-a' AND id = 101;
    `);
    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:101/contact',
      'POST',
      { channel: 'phone', outcome: 'Answered', note: 'Already paid.' },
    )).status).toBe(409);

    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:102/promise',
      'PUT',
      {
        promiseDate: '2099-07-20',
        promiseAmountMinor: 5001,
        currencyCode: 'BDT',
        note: 'Exceeds due.',
      },
    )).status).toBe(422);

    expect((await jsonRequest(
      app,
      '/action-center/collections/invoice/legacy-bill:102/escalate',
      'PUT',
      {
        reason: 'Supervisor review',
        note: 'Cross tenant assignee.',
        assignedTo: 20,
      },
    )).status).toBe(422);
  });

  it('returns 503 when canonical mode is enabled without its required schema', async () => {
    const { app } = makeApp({
      role: 'hospital_admin',
      setup: (harness) => {
        harness.sqlite.exec(`
          CREATE TABLE canonical_feature_flags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL,
            flag_key TEXT NOT NULL,
            domain TEXT NOT NULL,
            mode TEXT NOT NULL,
            is_enabled INTEGER NOT NULL,
            UNIQUE(tenant_id, flag_key)
          );
          INSERT INTO canonical_feature_flags (
            tenant_id, flag_key, domain, mode, is_enabled
          ) VALUES ('tenant-a', 'billing.receivables', 'billing', 'canonical', 1);
        `);
      },
    });

    const response = await app.request('/action-center/collections');
    const body = await response.json() as { error: string };
    expect(response.status).toBe(503);
    expect(body.error).toMatch(/canonical/i);
  });
});
