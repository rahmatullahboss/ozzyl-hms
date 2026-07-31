import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import billingCounterRoutes from '../../../src/routes/tenant/billingCounter';
import type { Env, Variables } from '../../../src/types';
import { createSqliteD1Harness } from '../../helpers/sqlite-d1';

describe('pending due worklist SQLite query', () => {
  it('combines bills, appointments, and standalone visit consultation dues with real pagination', async () => {
    const harness = createSqliteD1Harness();
    harness.sqlite.exec(`
      CREATE TABLE patients (id INTEGER PRIMARY KEY, tenant_id TEXT, name TEXT, patient_code TEXT);
      CREATE TABLE doctors (id INTEGER PRIMARY KEY, tenant_id TEXT, name TEXT);
      CREATE TABLE users (id INTEGER PRIMARY KEY, tenant_id TEXT, name TEXT);
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY, tenant_id TEXT, patient_id INTEGER, doctor_id INTEGER,
        appointment_id INTEGER, visit_date TEXT, created_at TEXT, status TEXT
      );
      CREATE TABLE bills (
        id INTEGER PRIMARY KEY, tenant_id TEXT, patient_id INTEGER, visit_id INTEGER,
        referring_doctor_id INTEGER, total REAL, paid REAL, due REAL, status TEXT,
        test_bill REAL, doctor_visit_bill REAL, operation_bill REAL, admission_bill REAL,
        medicine_bill REAL, invoice_no TEXT, created_at TEXT, created_by INTEGER
      );
      CREATE TABLE billing_deposits (
        id INTEGER PRIMARY KEY, tenant_id TEXT, reference_bill_id INTEGER, amount REAL,
        transaction_type TEXT, is_active INTEGER
      );
      CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, tenant_id TEXT, bill_id INTEGER, description TEXT);
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY, tenant_id TEXT, patient_id INTEGER, doctor_id INTEGER,
        token_no INTEGER, appt_time TEXT, appt_date TEXT, fee REAL, status TEXT, billing_status TEXT
      );
      CREATE TABLE billing_provisional_items (
        id INTEGER PRIMARY KEY, tenant_id TEXT, appointment_id INTEGER,
        total_amount REAL, bill_status TEXT, is_active INTEGER
      );
      CREATE TABLE visit_services (
        id INTEGER PRIMARY KEY, tenant_id TEXT, visit_id INTEGER,
        total_amount REAL, status TEXT, service_type TEXT
      );

      INSERT INTO patients VALUES
        (1, '100', 'Bill Patient', 'P-1'),
        (2, '100', 'Appointment Patient', 'P-2'),
        (3, '100', 'Visit Patient', 'P-3');
      INSERT INTO doctors VALUES (10, '100', 'Dr One'), (11, '100', 'Dr Two');
      INSERT INTO users VALUES (20, '100', 'Reception One');

      INSERT INTO bills VALUES
        (101, '100', 1, NULL, 10, 1000, 200, 800, 'partial', 1, 0, 0, 0, 0, 'INV-101', '2026-07-18 09:00:00', 20);
      INSERT INTO invoice_items VALUES (1, '100', 101, 'CBC');

      INSERT INTO appointments VALUES
        (201, '100', 2, 11, 12, '10:30', '2026-07-18', 500, 'scheduled', 'pending');
      INSERT INTO billing_provisional_items VALUES
        (1, '100', 201, 500, 'provisional', 1);

      INSERT INTO visits VALUES
        (301, '100', 3, 10, NULL, '2026-07-18', '2026-07-18 11:00:00', 'active');
      INSERT INTO visit_services VALUES
        (1, '100', 301, 300, 'pending', 'doctor_visit');
    `);

    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use('*', async (c, next) => {
      c.set('tenantId', '100');
      c.set('userId', '1');
      c.set('role', 'hospital_admin');
      c.env = { DB: harness.db, ENVIRONMENT: 'test', JWT_SECRET: 'test-secret' } as unknown as Env;
      await next();
    });
    app.route('/billing-counter', billingCounterRoutes);
    app.onError((error, c) => c.json({ error: error.message }, ((error as { status?: number }).status ?? 500) as 500));

    const first = await app.request('/billing-counter/pending-due-worklist?page=1&limit=2');
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      data: [
        { source_type: 'bill', source_id: 101, amount: 800 },
        { source_type: 'appointment', source_id: 201, amount: 500 },
      ],
      pagination: { page: 1, limit: 2, total: 3, pages: 2 },
    });

    const second = await app.request('/billing-counter/pending-due-worklist?page=2&limit=2');
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      data: [{ source_type: 'visit', source_id: 301, amount: 300 }],
      pagination: { page: 2, limit: 2, total: 3, pages: 2 },
    });
  });
});
