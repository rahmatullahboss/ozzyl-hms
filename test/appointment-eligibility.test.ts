import { describe, expect, it } from 'vitest';
import appointmentRoutes from '../src/routes/tenant/appointments-with-paid-context';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createSqliteD1Harness } from './helpers/sqlite-d1';

const TENANT_ID = 'tenant-eligibility';
const baseTables = {
  doctors: [{ id: 1, tenant_id: TENANT_ID, name: 'Dr Aminul', consultation_fee: 500, is_active: 1 }],
  appointments: [],
  visits: [],
};

describe('appointment eligibility windows', () => {
  it('blocks report-show serial when the patient has not completed a recent visit with the same doctor', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: baseTables,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from (') && sql.toLowerCase().includes('from visits v')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 10,
        doctorId: 1,
        apptDate: '2026-05-16',
        appointmentType: 'report_show',
        visitType: 'followup',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Report-show is allowed');
    expect(mockDB.queries.map(q => q.sql).join('\n')).not.toMatch(/INSERT\s+INTO\s+"?appointments"?/i);
  });

  it('allows report-show serial within the configured doctor window', async () => {
    const { app } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: baseTables,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_appointment_fees') && s.includes('eligibility_days')) {
          return { results: [{ eligibility_days: 7 }] };
        }
        if (s.includes('from (') && s.includes('from visits v')) {
          return { results: [{ visit_date: '2026-05-12', doctor_id: 1 }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 10,
        doctorId: 1,
        apptDate: '2026-05-16',
        appointmentType: 'report_show',
        visitType: 'followup',
      },
    });

    expect(res.status).toBe(201);
  });

  it('allows old-patient discounted fee when a prior doctor visit has any positive payment', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: baseTables,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_appointment_fees') && s.includes('eligibility_days')) {
          return { results: [{ eligibility_days: 30 }] };
        }
        if (s.includes('returning_patient_positive_payment')) {
          return { results: [{ visit_date: '2026-05-12', doctor_id: 1 }] };
        }
        if (s.includes('from (') && s.includes('from visits v')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 10,
        doctorId: 1,
        apptDate: '2026-05-16',
        appointmentType: 'old_patient',
        visitType: 'followup',
      },
    });

    expect(res.status).toBe(201);
    const eligibilitySql = mockDB.queries.map(q => q.sql).find(sql => sql.includes('returning_patient_positive_payment')) ?? '';
    expect(eligibilitySql).toContain('p.amount > 0');
    expect(eligibilitySql).toContain("COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')");
    expect(eligibilitySql).toContain("ii.item_category = 'doctor_visit'");
    expect(eligibilitySql).toContain("bp.bill_status = 'finalized'");
    expect(eligibilitySql).toContain('COALESCE(bp.is_active, 1) = 1');
    expect(eligibilitySql).not.toContain("v.status");
    expect(eligibilitySql).toContain('AND doctor_id = ?');
    const eligibilityQuery = mockDB.queries.find(q => q.sql.includes('returning_patient_positive_payment'));
    expect(eligibilityQuery?.params).toEqual([TENANT_ID, 10, '2026-04-17', '2026-05-16', 1]);
  });

  it('blocks old-patient discounted fee when the patient has no positive payment in the returning window', async () => {
    const { app } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'reception',
      tenantId: TENANT_ID,
      tables: baseTables,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctor_appointment_fees') && s.includes('eligibility_days')) {
          return { results: [{ eligibility_days: 30 }] };
        }
        if (s.includes('returning_patient_positive_payment')) {
          return { results: [] };
        }
        if (s.includes('from (') && s.includes('from visits v')) {
          return { results: [] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 10,
        doctorId: 1,
        apptDate: '2026-05-16',
        appointmentType: 'old_patient',
        visitType: 'followup',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('positive payment for a doctor visit');
  });

  it('executes the positive-payment guard against SQLite without requiring a completed visit', async () => {
    const harness = createSqliteD1Harness();
    harness.sqlite.exec(`
      CREATE TABLE doctors (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT,
        specialty TEXT,
        department TEXT,
        consultation_fee REAL,
        is_active INTEGER DEFAULT 1
      );
      CREATE TABLE doctor_appointment_fees (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        doctor_id INTEGER NOT NULL,
        appointment_type TEXT NOT NULL,
        fee REAL,
        eligibility_days INTEGER,
        is_active INTEGER DEFAULT 1
      );
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER,
        appt_date TEXT,
        appointment_type TEXT,
        status TEXT
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER,
        appointment_id INTEGER,
        visit_date TEXT,
        created_at TEXT,
        status TEXT
      );
      CREATE TABLE bills (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id INTEGER NOT NULL,
        visit_id INTEGER,
        doctor_visit_bill REAL,
        status TEXT,
        created_at TEXT
      );
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bill_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        date TEXT
      );
      CREATE TABLE billing_provisional_items (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        billed_bill_id INTEGER,
        item_category TEXT,
        appointment_id INTEGER,
        bill_status TEXT,
        is_active INTEGER DEFAULT 1,
        cancelled_at TEXT
      );
      CREATE TABLE invoice_items (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bill_id INTEGER NOT NULL,
        item_category TEXT NOT NULL,
        status TEXT
      );

      INSERT INTO doctors VALUES (1, '${TENANT_ID}', 'Dr Aminul', 'Medicine', 'OPD', 500, 1);
      INSERT INTO doctors VALUES (2, '${TENANT_ID}', 'Dr Farhana', 'Medicine', 'OPD', 600, 1);
      INSERT INTO doctor_appointment_fees VALUES (1, '${TENANT_ID}', 1, 'old_patient', 300, 30, 1);
      INSERT INTO doctor_appointment_fees VALUES (2, '${TENANT_ID}', 2, 'old_patient', 350, 30, 1);
      INSERT INTO appointments VALUES (11, '${TENANT_ID}', 10, 1, '2026-05-12', 'new_patient', 'scheduled');
      INSERT INTO visits VALUES (21, '${TENANT_ID}', 10, 1, 11, '2026-05-12', '2026-05-12 09:00:00', 'waiting');
      INSERT INTO bills VALUES (31, '${TENANT_ID}', 10, 21, 500, 'open', '2026-05-12 09:05:00');
      INSERT INTO payments VALUES (41, '${TENANT_ID}', 31, 100, '2026-05-12 09:10:00');
      INSERT INTO invoice_items VALUES (51, '${TENANT_ID}', 31, 'doctor_visit', 'active');
    `);

    const { app } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'reception',
      tenantId: TENANT_ID,
      extraEnv: { DB: harness.db },
    });

    const eligible = await app.request('/appointments/fee-preview?doctorId=1&patientId=10&appointmentType=old_patient&apptDate=2026-05-16');
    const eligibleBody = await eligible.json();
    expect(eligible.status, JSON.stringify(eligibleBody)).toBe(200);
    expect(eligibleBody).toMatchObject({
      eligibility: {
        eligible: true,
        lastVisitDate: '2026-05-12',
      },
    });

    const differentDoctor = await app.request('/appointments/fee-preview?doctorId=2&patientId=10&appointmentType=old_patient&apptDate=2026-05-16');
    expect(differentDoctor.status).toBe(200);
    expect(await differentDoctor.json()).toMatchObject({
      eligibility: {
        eligible: false,
        lastVisitDate: null,
      },
    });

    harness.sqlite.exec(`
      UPDATE payments SET amount = 0 WHERE id = 41;
      INSERT INTO bills VALUES (32, 'tenant-other', 10, NULL, 500, 'open', '2026-05-12 09:05:00');
      INSERT INTO payments VALUES (42, 'tenant-other', 32, 100, '2026-05-12 09:10:00');
      INSERT INTO bills VALUES (33, '${TENANT_ID}', 99, NULL, 500, 'open', '2026-05-12 09:05:00');
      INSERT INTO payments VALUES (43, '${TENANT_ID}', 33, 100, '2026-05-12 09:10:00');
      INSERT INTO bills VALUES (34, '${TENANT_ID}', 10, NULL, 500, 'open', '2026-04-16 09:05:00');
      INSERT INTO payments VALUES (44, '${TENANT_ID}', 34, 100, '2026-04-16 09:10:00');
    `);
    const blocked = await app.request('/appointments/fee-preview?doctorId=1&patientId=10&appointmentType=old_patient&apptDate=2026-05-16');
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toMatchObject({
      eligibility: {
        eligible: false,
        lastVisitDate: null,
      },
    });

    harness.sqlite.exec("UPDATE payments SET amount = 100 WHERE id = 41; UPDATE bills SET status = 'refunded' WHERE id = 31");
    const refunded = await app.request('/appointments/fee-preview?doctorId=1&patientId=10&appointmentType=old_patient&apptDate=2026-05-16');
    expect(refunded.status).toBe(200);
    expect(await refunded.json()).toMatchObject({
      eligibility: {
        eligible: false,
        lastVisitDate: null,
      },
    });
  });

  it('returns selected-doctor and latest-any-doctor paid appointment context while ignoring unpaid appointments', async () => {
    const harness = createSqliteD1Harness();
    harness.sqlite.exec(`
      CREATE TABLE doctors (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT,
        specialty TEXT,
        department TEXT,
        consultation_fee REAL,
        is_active INTEGER DEFAULT 1
      );
      CREATE TABLE doctor_appointment_fees (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        doctor_id INTEGER NOT NULL,
        appointment_type TEXT NOT NULL,
        fee REAL,
        eligibility_days INTEGER,
        is_active INTEGER DEFAULT 1
      );
      CREATE TABLE appointments (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER,
        appt_date TEXT,
        appointment_type TEXT,
        status TEXT
      );
      CREATE TABLE visits (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id INTEGER NOT NULL,
        doctor_id INTEGER,
        appointment_id INTEGER,
        visit_date TEXT,
        created_at TEXT,
        status TEXT
      );
      CREATE TABLE bills (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        patient_id INTEGER NOT NULL,
        visit_id INTEGER,
        doctor_visit_bill REAL,
        status TEXT,
        created_at TEXT
      );
      CREATE TABLE payments (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bill_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        date TEXT
      );
      CREATE TABLE billing_provisional_items (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        billed_bill_id INTEGER,
        item_category TEXT,
        appointment_id INTEGER,
        bill_status TEXT,
        is_active INTEGER DEFAULT 1,
        cancelled_at TEXT
      );
      CREATE TABLE invoice_items (
        id INTEGER PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        bill_id INTEGER NOT NULL,
        item_category TEXT NOT NULL,
        status TEXT
      );

      INSERT INTO doctors VALUES (1, '${TENANT_ID}', 'Dr Aminul', 'Medicine', 'OPD', 500, 1);
      INSERT INTO doctors VALUES (2, '${TENANT_ID}', 'Dr Farhana', 'Cardiology', 'OPD', 600, 1);
      INSERT INTO doctor_appointment_fees VALUES (1, '${TENANT_ID}', 1, 'old_patient', 300, 30, 1);
      INSERT INTO appointments VALUES (11, '${TENANT_ID}', 10, 1, '2026-05-12', 'new_patient', 'scheduled');
      INSERT INTO appointments VALUES (12, '${TENANT_ID}', 10, 2, '2026-05-15', 'old_patient', 'cancelled');
      INSERT INTO appointments VALUES (13, '${TENANT_ID}', 10, 1, '2026-05-19', 'old_patient', 'scheduled');
      INSERT INTO visits VALUES (21, '${TENANT_ID}', 10, 1, 11, '2026-05-12', '2026-05-12 09:00:00', 'waiting');
      INSERT INTO visits VALUES (22, '${TENANT_ID}', 10, 2, 12, '2026-05-15', '2026-05-15 11:00:00', 'waiting');
      INSERT INTO bills VALUES (31, '${TENANT_ID}', 10, 21, 500, 'open', '2026-05-12 09:05:00');
      INSERT INTO bills VALUES (32, '${TENANT_ID}', 10, 22, 600, 'open', '2026-05-15 11:05:00');
      INSERT INTO payments VALUES (41, '${TENANT_ID}', 31, 100, '2026-05-12 09:10:00');
      INSERT INTO payments VALUES (42, '${TENANT_ID}', 32, 200, '2026-05-15 11:20:00');
      INSERT INTO invoice_items VALUES (51, '${TENANT_ID}', 31, 'doctor_visit', 'active');
      INSERT INTO invoice_items VALUES (52, '${TENANT_ID}', 32, 'doctor_visit', 'active');
    `);

    const { app } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'reception',
      tenantId: TENANT_ID,
      extraEnv: { DB: harness.db },
    });

    const response = await app.request('/appointments/fee-preview?doctorId=1&patientId=10&appointmentType=old_patient&apptDate=2026-05-20');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      paidVisitContext: {
        selectedDoctor: {
          appointmentId: 11,
          doctorId: 1,
          doctorName: 'Dr Aminul',
          appointmentType: 'new_patient',
          appointmentDate: '2026-05-12',
          paidAt: '2026-05-12 09:10:00',
        },
        latestAnyDoctor: {
          appointmentId: 12,
          doctorId: 2,
          doctorName: 'Dr Farhana',
          appointmentType: 'old_patient',
          appointmentDate: '2026-05-15',
          paidAt: '2026-05-15 11:20:00',
        },
      },
    });

    const noHistoryResponse = await app.request('/appointments/fee-preview?doctorId=1&patientId=20&appointmentType=new_patient&apptDate=2026-05-20');
    expect(noHistoryResponse.status).toBe(200);
    expect(await noHistoryResponse.json()).toMatchObject({
      paidVisitContext: {
        selectedDoctor: null,
        latestAnyDoctor: null,
      },
    });
  });

});
