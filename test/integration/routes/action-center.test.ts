import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import actionCenterRoutes from '../../../src/routes/tenant/actionCenter';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

const providerReviewsMigration = readFileSync('migrations/0121_provider_reviews.sql', 'utf8');
const exceptionMigration = readFileSync('migrations/0500_admin_exception_cases.sql', 'utf8');
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

    CREATE TABLE approval_requests (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      type TEXT,
      entity_id INTEGER,
      requested_by INTEGER,
      request_data TEXT,
      status TEXT,
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
  `);
  harness.sqlite.exec(providerReviewsMigration);
  harness.sqlite.exec(exceptionMigration);
  harness.sqlite.exec(collectionMigration);
  harness.sqlite.exec(taskMigration);
  harness.sqlite.exec(`
    INSERT INTO users (id, tenant_id, name)
    VALUES (7, 'tenant-a', 'Hospital Admin');

    INSERT INTO patients (id, tenant_id, name, mobile) VALUES
      (1, 'tenant-a', 'Alice Patient', '01700000001'),
      (2, 'tenant-a', 'Bob Patient', '01700000002'),
      (20, 'tenant-b', 'Private Tenant Patient', '01800000020');
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

function insertException(
  harness: ReturnType<typeof setupDatabase>,
  input: {
    id: number;
    status: 'open' | 'acknowledged' | 'in_progress' | 'snoozed' | 'resolved';
    severity?: 'critical' | 'warning' | 'info';
    ruleKey?: string;
    firstDetectedAt?: string;
    resolvedAt?: string | null;
    snoozedUntil?: string | null;
  },
) {
  const detectedAt = input.firstDetectedAt ?? '2026-07-10 08:00:00';
  harness.sqlite.prepare(`
    INSERT INTO admin_exception_cases (
      id, tenant_id, rule_key, fingerprint, source_type, source_id, module,
      severity, title, description, status, first_detected_at, last_detected_at,
      resolved_at, snoozed_until, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)
  `).run(
    input.id,
    'tenant-a',
    input.ruleKey ?? 'cash.stale_handover',
    `exception:${input.id}`,
    'cash_handover',
    String(input.id),
    'cash',
    input.severity ?? 'warning',
    `Exception ${input.id}`,
    'Persistent operational exception.',
    input.status,
    detectedAt,
    detectedAt,
    input.resolvedAt ?? null,
    input.snoozedUntil ?? null,
    detectedAt,
    detectedAt,
  );
}

describe('Action Center API', () => {
  describe('GET /action-center/summary', () => {
    it('rejects requests without an authorised operational role', async () => {
      const { app } = makeApp();
      expect((await app.request('/action-center/summary')).status).toBe(403);
    });

    it('returns one honest cross-workstream summary with tenant-scoped collection authority', async () => {
      const { app } = makeApp({
        role: 'hospital_admin',
        setup: (harness) => {
          harness.sqlite.prepare(`
            INSERT INTO approval_requests (
              id, tenant_id, type, entity_id, requested_by, request_data,
              status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            10,
            'tenant-a',
            'bill_edit',
            101,
            2,
            JSON.stringify({ amount: 1200, reason: 'Correction required' }),
            'pending',
            new Date().toISOString(),
          );
          const issuedAt = new Date(Date.now() + 6 * 60 * 60 * 1000)
            .toISOString()
            .slice(0, 19)
            .replace('T', ' ');
          harness.sqlite.exec(`
            INSERT INTO bills (
              id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
            ) VALUES
              (101, 'tenant-a', 1, 'INV-101', 500, 100, 400, 'open', '${issuedAt}'),
              (102, 'tenant-a', 2, 'INV-102', 500, 150, 350, 'open', '${issuedAt}'),
              (201, 'tenant-b', 20, 'PRIVATE-B', 999, 0, 999, 'open', '${issuedAt}');
          `);
        },
      });

      const response = await app.request('/action-center/summary');
      const body = await response.json() as {
        data: {
          approvals: { totalPending: number };
          exceptions: { open: number; critical: number; slaBreached: number; byRule: Record<string, number> };
          collections: Record<string, unknown>;
          tasks: { open: number; overdue: number; assignedToMe: number };
          resolvedToday: number;
          nextBestAction: { workstream: string; href: string; priority: string } | null;
          capabilities: {
            persistentExceptions: boolean;
            persistentCollections: boolean;
            persistentTasks: boolean;
          };
        };
      };

      expect(response.status).toBe(200);
      expect(body.data).toEqual(expect.objectContaining({
        approvals: expect.objectContaining({ totalPending: 1 }),
        exceptions: { open: 0, critical: 0, slaBreached: 0, byRule: {} },
        collections: {
          open: 2,
          followupDue: 0,
          exposure: 750,
          exposureMinor: 75000,
          currencyCode: 'BDT',
          amountsByCurrency: [expect.objectContaining({
            currencyCode: 'BDT',
            totalDueMinor: 75000,
            totalInvoices: 2,
          })],
          authorityMode: 'legacy',
          shadowMismatchCount: 0,
        },
        tasks: { open: 0, overdue: 0, assignedToMe: 0 },
        resolvedToday: 0,
        capabilities: {
          persistentExceptions: true,
          persistentCollections: true,
          persistentTasks: true,
        },
      }));
      expect(body.data.nextBestAction).toEqual(expect.objectContaining({
        workstream: 'approvals',
        href: '/action/approvals?status=pending',
      }));
    });

    it('returns a healthy null next-best-action when every workstream is empty', async () => {
      const { app } = makeApp({ role: 'hospital_admin' });

      const response = await app.request('/action-center/summary');
      const body = await response.json() as {
        data: {
          collections: { open: number; exposureMinor: number | null };
          nextBestAction: unknown;
        };
      };

      expect(response.status).toBe(200);
      expect(body.data.collections).toEqual(expect.objectContaining({
        open: 0,
        exposureMinor: 0,
      }));
      expect(body.data.nextBestAction).toBeNull();
    });

    it('prioritises critical persistent exceptions and excludes future snoozes', async () => {
      const { app } = makeApp({
        role: 'hospital_admin',
        setup: (harness) => {
          const today = getTodayGMT6();
          insertException(harness, {
            id: 1,
            status: 'open',
            severity: 'critical',
            ruleKey: 'billing.missing_discount_reference',
          });
          insertException(harness, { id: 2, status: 'acknowledged' });
          insertException(harness, { id: 3, status: 'in_progress' });
          insertException(harness, {
            id: 4,
            status: 'snoozed',
            snoozedUntil: '2099-01-01 00:00:00',
          });
          insertException(harness, {
            id: 5,
            status: 'resolved',
            resolvedAt: `${today} 10:00:00`,
          });
          insertException(harness, {
            id: 6,
            status: 'resolved',
            resolvedAt: `${today} 11:00:00`,
          });
        },
      });

      const response = await app.request('/action-center/summary');
      const body = await response.json() as {
        data: {
          exceptions: { open: number; critical: number; slaBreached: number; byRule: Record<string, number> };
          resolvedToday: number;
          nextBestAction: { workstream: string; href: string; priority: string } | null;
          capabilities: { persistentExceptions: boolean; persistentCollections: boolean };
        };
      };

      expect(response.status).toBe(200);
      expect(body.data.exceptions).toEqual({
        open: 3,
        critical: 1,
        slaBreached: 3,
        byRule: {
          'billing.missing_discount_reference': 1,
          'cash.stale_handover': 2,
        },
      });
      expect(body.data.resolvedToday).toBe(2);
      expect(body.data.capabilities).toEqual(expect.objectContaining({
        persistentExceptions: true,
        persistentCollections: true,
      }));
      expect(body.data.nextBestAction).toEqual({
        workstream: 'exceptions',
        href: '/action/exceptions?status=active&severity=critical',
        label: 'Review critical exception',
        priority: 'critical',
      });
    });
  });
});
