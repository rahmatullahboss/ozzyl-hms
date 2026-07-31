import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import adminRoutes from '../../../src/routes/admin/withActionCenterCollections';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

const collectionMigration = readFileSync('migrations/0501_collection_cases.sql', 'utf8');

function legacyLocalTimestampNow(): string {
  const local = new Date(Date.now() + 6 * 60 * 60 * 1000);
  return local.toISOString().slice(0, 19).replace('T', ' ');
}

function makeApp(options: {
  role?: string;
  tenantId?: string;
  setup?: (harness: ReturnType<typeof createSqliteD1Harness>) => void;
} = {}) {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(`
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
  `);
  harness.sqlite.exec(collectionMigration);

  const timestamp = legacyLocalTimestampNow();
  harness.sqlite.prepare(`
    INSERT INTO patients (id, tenant_id, name, mobile)
    VALUES (?, ?, ?, ?)
  `).run(1, 'tenant-a', 'Tenant A Patient', '01700000001');
  harness.sqlite.prepare(`
    INSERT INTO patients (id, tenant_id, name, mobile)
    VALUES (?, ?, ?, ?)
  `).run(2, 'tenant-b', 'Private Tenant B Patient', '01800000002');

  const insertBill = harness.sqlite.prepare(`
    INSERT INTO bills (
      id, tenant_id, patient_id, invoice_no, total, paid, due, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (let id = 1; id <= 105; id += 1) {
    insertBill.run(
      id,
      'tenant-a',
      1,
      `INV-${String(id).padStart(3, '0')}`,
      10,
      0,
      10,
      'open',
      timestamp,
    );
  }
  insertBill.run(1001, 'tenant-b', 2, 'PRIVATE-B', 999, 0, 999, 'open', timestamp);
  options.setup?.(harness);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', options.tenantId ?? 'tenant-a');
    c.set('userId', '7');
    if (options.role) c.set('role', options.role as Variables['role']);
    c.env = {
      DB: harness.db,
      ENVIRONMENT: 'test',
      JWT_SECRET: 'test-secret',
    } as Env;
    await next();
  });
  app.route('/admin', adminRoutes);
  app.onError((error, c) => c.json(
    { error: error.message },
    ((error as { status?: number }).status ?? 500) as 400,
  ));

  return { app, harness };
}

describe('legacy admin due receivables compatibility adapter', () => {
  it('rejects requests without an authorised admin role', async () => {
    const { app } = makeApp();
    expect((await app.request('/admin/due-receivables')).status).toBe(403);
  });

  it('returns 500 instead of a false empty success when the receivable query fails', async () => {
    const { app } = makeApp({
      role: 'hospital_admin',
      setup: (harness) => harness.sqlite.exec('DROP TABLE bills;'),
    });

    const response = await app.request('/admin/due-receivables');
    const body = await response.json() as { error?: string; receivables?: unknown[] };

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/due receivables/i);
    expect(body).not.toHaveProperty('receivables');
  });

  it('returns a capped compatibility page with uncapped full-dataset totals', async () => {
    const { app } = makeApp({ role: 'hospital_admin' });

    const response = await app.request('/admin/due-receivables');
    const body = await response.json() as {
      receivables: Array<Record<string, unknown>>;
      summary: {
        totalDue: number | null;
        totalInvoices: number;
        currencyCode: string | null;
        aging: Record<string, number>;
        amountsByCurrency: Array<Record<string, unknown>>;
        authorityMode: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.receivables).toHaveLength(100);
    expect(body.receivables[0]).toEqual(expect.objectContaining({
      id: 'legacy-bill:1',
      type: 'patient',
      invoice: 'INV-001',
      party: 'Tenant A Patient',
      total: 10,
      paid: 0,
      due: 10,
      contact: '01700000001',
    }));
    expect(body.receivables.some((item) => item.invoice === 'PRIVATE-B')).toBe(false);
    expect(body.summary).toEqual({
      totalDue: 1050,
      totalInvoices: 105,
      current: 1050,
      days30: 0,
      days60: 0,
      days90Plus: 0,
      currencyCode: 'BDT',
      aging: {
        '0-7': 105,
        '8-30': 0,
        '31-60': 0,
        '60+': 0,
      },
      amountsByCurrency: [expect.objectContaining({
        currencyCode: 'BDT',
        totalDueMinor: 105000,
        totalInvoices: 105,
      })],
      authorityMode: 'legacy',
      shadowMismatchCount: 0,
    });
  });
});
