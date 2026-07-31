import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

describe('doctor complete consultation workflow', () => {
  it('blocks direct completed status updates so visits must close through Save & Complete', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/status', {
      method: 'PUT',
      body: { status: 'completed' },
    });

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('update appointments'))).toBe(false);
  });

  it('saves clinical note and completes appointment lifecycle through one endpoint', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 7,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }

        if (lower.includes('insert into formsoap')) {
          return { meta: { changes: 1, last_row_id: 77 } };
        }

        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        soap: {
          chiefComplaint: 'Fever',
          subjective: 'Fever for 3 days',
          assessment: 'Acute febrile illness',
          plan: 'Hydration and follow up',
        },
        completeVisit: true,
      },
    });

    expect(res.status, await res.clone().text()).toBe(200);
    const body = await res.json() as {
      soap: { id: number };
      lifecycle: { appointmentStatus: string; queueStatus: string };
    };
    expect(body.soap.id).toBe(77);
    expect(body.lifecycle.appointmentStatus).toBe('completed');
    expect(body.lifecycle.queueStatus).toBe('completed');

    const executedSql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(executedSql).toContain('insert into formsoap');
    expect(executedSql).toContain('update appointments');
    expect(executedSql).toContain('update queue_entries');
    const lifecycleWrites = mockDB.queries.filter((query) =>
      /update\s+(appointments|visits|queue_entries)/i.test(query.sql)
    );
    expect(lifecycleWrites).toHaveLength(3);
    expect(lifecycleWrites.every((query) => query.method === 'all')).toBe(true);
    const claimInsertIndex = mockDB.queries.findIndex((query) =>
      query.sql.toLowerCase().includes('insert or ignore into consultation_completion_claims')
    );
    const soapInsertIndex = mockDB.queries.findIndex((query) =>
      query.sql.toLowerCase().includes('insert into formsoap')
    );
    expect(claimInsertIndex).toBeGreaterThanOrEqual(0);
    expect(soapInsertIndex).toBeGreaterThan(claimInsertIndex);
  });

  it('commits a hashed signed encounter envelope in the same lifecycle batch', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('insert into formsoap')) {
          return { meta: { changes: 1, last_row_id: 77 } };
        }
        if (lower.includes('from lab_orders') && lower.includes('count')) {
          return { first: { count: 1 } };
        }
        if (lower.includes('from lab_orders') && !lower.includes('count')) {
          return { results: [{ id: 201, order_no: 'LAB-201', status: 'pending' }] };
        }
        if (lower.includes('from radiology_requisitions') && lower.includes('count')) {
          return { first: { count: 0 } };
        }
        if (lower.includes('from radiology_requisitions') && !lower.includes('count')) {
          return { results: [] };
        }
        if (lower.includes('from encounters') && lower.includes('appointment_id = ?')) {
          return {
            first: {
              id: 700,
              patient_id: 12,
              visit_id: 99,
              appointment_id: 44,
              form_soap_id: 77,
              prescription_id: null,
              order_refs_json: '[{"type":"lab","id":201}]',
              snapshot_hash: 'a'.repeat(64),
              signed_by: 9,
              signed_at: '2026-05-17 10:00:00',
              signature_version: 1,
              addendum_count: 0,
              status: 'signed',
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        soap: {
          chiefComplaint: 'Fever',
          assessment: 'Acute febrile illness',
        },
        orderSummary: { count: 1 },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      lifecycle: {
        appointmentStatus: 'completed',
        alreadyCompleted: false,
        signedEncounter: { id: 700, status: 'signed', signature_version: 1 },
      },
    });

    expect(mockDB.batchCalls).toHaveLength(1);
    expect(mockDB.batchCalls[0].length).toBeGreaterThanOrEqual(4);
    expect(mockDB.batchCalls[0].some((sql) => sql.toLowerCase().includes('insert or ignore into encounters'))).toBe(true);
    expect(mockDB.batchCalls[0].some((sql) => sql.toLowerCase().includes('update appointments'))).toBe(true);
    expect(mockDB.batchCalls[0].some((sql) => sql.toLowerCase().includes('update visits'))).toBe(true);
    expect(mockDB.batchCalls[0].some((sql) => sql.toLowerCase().includes('update queue_entries'))).toBe(true);

    const encounterInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert or ignore into encounters')
    );
    const snapshotParam = encounterInsert?.params.find((param) =>
      typeof param === 'string' && param.includes('"signatureVersion":1')
    );
    expect(typeof snapshotParam).toBe('string');
    const snapshot = JSON.parse(String(snapshotParam));
    expect(snapshot.soap).toMatchObject({ id: 77, chiefComplaint: 'Fever' });
    expect(snapshot.clinicalOrders).toEqual([{
      type: 'lab', id: 201, orderNo: 'LAB-201', status: 'pending',
    }]);
    const hashParam = encounterInsert?.params.find((param) =>
      typeof param === 'string' && /^[a-f0-9]{64}$/.test(param)
    );
    expect(hashParam).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the existing signed encounter on completion retry without writing new clinical content', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'completed',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('from encounters') && lower.includes('appointment_id = ?')) {
          return {
            first: {
              id: 700,
              patient_id: 12,
              visit_id: 99,
              appointment_id: 44,
              snapshot_hash: 'b'.repeat(64),
              signed_at: '2026-05-17 10:00:00',
              signature_version: 1,
              addendum_count: 0,
              status: 'signed',
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        soap: { chiefComplaint: 'Changed after signing' },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      message: 'Consultation already completed',
      lifecycle: {
        alreadyCompleted: true,
        signedEncounter: { id: 700, status: 'signed' },
      },
    });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into formsoap'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into prescriptions'))).toBe(false);
    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('update consultation_completion_claims')
      && query.sql.toLowerCase().includes("status = 'completed'")
    )).toBe(true);
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('rejects a concurrent active completion claim before writing SOAP, diagnosis, prescription, or lifecycle state', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('insert or ignore into consultation_completion_claims')) {
          return { meta: { changes: 0, last_row_id: 0 } };
        }
        if (lower.includes('from consultation_completion_claims')) {
          return {
            first: {
              id: 800,
              appointment_id: 44,
              patient_id: 12,
              visit_id: 99,
              doctor_id: 1,
              idempotency_key: 'doctor-completion:44:1',
              request_hash: 'a'.repeat(64),
              status: 'processing',
              lease_owner: 'active-owner',
              lease_active: 1,
              soap_id: null,
              diagnosis_id: null,
              prescription_id: null,
              encounter_id: null,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        soap: { chiefComplaint: 'Fever', assessment: 'Acute febrile illness' },
        completionIdempotencyKey: 'complete-44-concurrent-2',
        completeVisit: true,
      },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringMatching(/already being processed/i),
    });
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).not.toContain('insert into formsoap');
    expect(sql).not.toContain('insert into clinicaldiagnosis');
    expect(sql).not.toContain('insert into prescriptions');
    expect(sql).not.toContain('update appointments');
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('records an issuance snapshot when consultation completion finalizes a prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }

        if (
          lower.includes('patient_allergies')
          || lower.includes('patient_active_medications')
          || lower.includes('drug_interaction_pairs')
          || lower.includes('formulary')
        ) {
          return { results: [] };
        }

        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        prescription: {
          status: 'final',
          diagnosis: 'Hypertension',
          items: [{
            medicine_name: 'Amlodipine',
            dosage: '5 mg',
            frequency: 'Once daily',
            duration: '30 days',
          }],
        },
        completeVisit: false,
      },
    });

    expect(res.status).toBe(200);
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).toContain("set status = 'final'");
    expect(sql).toContain('prescription_versions');
    const activeMedicationInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert or ignore into patient_active_medications')
    );
    expect(activeMedicationInsert?.sql.toLowerCase()).toContain('dosage');
    expect(activeMedicationInsert?.sql.toLowerCase()).not.toMatch(/\bdose\b/);
  });

  it('persists mapped medicine and prescribed quantity from the doctor workspace', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from appointments a') && sql.toLowerCase().includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              visit_id: 99,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        prescription: {
          status: 'draft',
          diagnosis: 'Hypertension',
          items: [{
            medicine_name: 'Amlodipine 5 mg',
            medicineId: 501,
            quantity: 30,
            frequency: 'Once daily',
          }],
        },
        completeVisit: false,
      },
    });

    expect(res.status).toBe(200);
    const itemInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into prescription_items')
    );
    expect(itemInsert?.sql.toLowerCase()).toContain('medicine_id');
    expect(itemInsert?.sql.toLowerCase()).toContain('quantity');
    expect(itemInsert?.params).toContain(501);
    expect(itemInsert?.params).toContain(30);
  });


  it('does not trust client order summary when no matching clinical order exists', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('from lab_orders') && lower.includes('count')) {
          return { first: { count: 0 } };
        }
        if (lower.includes('from radiology_requisitions') && lower.includes('count')) {
          return { first: { count: 0 } };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        orderSummary: { count: 1 },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(400);
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).toContain('from lab_orders');
    expect(sql).toContain('from radiology_requisitions');
    expect(sql).not.toContain('update appointments');
  });

  it('allows order-only completion when a matching clinical order exists', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('from lab_orders') && lower.includes('count')) {
          return { first: { count: 1 } };
        }
        if (lower.includes('from radiology_requisitions') && lower.includes('count')) {
          return { first: { count: 0 } };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        orderSummary: { count: 1 },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { lifecycle: { appointmentStatus: string; queueStatus: string } };
    expect(body.lifecycle.appointmentStatus).toBe('completed');
    expect(body.lifecycle.queueStatus).toBe('completed');
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).toContain('update appointments');
  });


  it('returns appointment clinical order statuses for the signed-in doctor', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments') && lower.includes('appt_date')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              appt_date: '2026-05-17',
            },
          };
        }
        if (lower.includes('from lab_orders')) {
          return {
            results: [{
              id: 10,
              type: 'lab',
              label: 'CBC',
              orderNo: 'LAB-1',
              invoiceNo: 'INV-1',
              billingStatus: 'paid',
              status: 'completed',
              total: 500,
              orderedAt: '2026-05-17',
              reportReady: 1,
            }],
          };
        }
        if (lower.includes('from radiology_requisitions')) {
          return {
            results: [{
              id: 11,
              type: 'imaging',
              label: 'Chest X-Ray PA View',
              orderNo: 'RAD-1',
              invoiceNo: 'INV-2',
              billingStatus: 'unpaid',
              status: 'pending',
              total: 700,
              orderedAt: '2026-05-17',
              reportReady: 0,
            }],
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await app.request('/doctors/dashboard/appointments/44/clinical-orders', { method: 'GET' });

    expect(res.status).toBe(200);
    const body = await res.json() as { orders: Array<{ type: string; label: string; reportReady: boolean }> };
    expect(body.orders).toHaveLength(2);
    expect(body.orders[0]).toMatchObject({ type: 'lab', label: 'CBC', reportReady: true });
    expect(body.orders[1]).toMatchObject({ type: 'imaging', label: 'Chest X-Ray PA View', reportReady: false });
  });

  it('validates and stores a canonical ICD-10 diagnosis as visit-scoped clinical content', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('from icd10diseases') && lower.includes('icd10code = ?')) {
          return {
            first: {
              ICD10ID: 501,
              ICD10Code: 'J06.9',
              DiseaseName: 'Acute upper respiratory infection, unspecified',
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        codedDiagnosis: {
          system: 'ICD-10',
          code: 'J06.9',
          description: 'Client-provided text must not be trusted',
        },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      codedDiagnosis: {
        system: 'ICD-10',
        code: 'J06.9',
        description: 'Acute upper respiratory infection, unspecified',
      },
      lifecycle: { appointmentStatus: 'completed', queueStatus: 'completed' },
    });

    const visitUpdate = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('update visits')
      && query.sql.toLowerCase().includes('icd10_code')
    );
    expect(visitUpdate?.params).toEqual(expect.arrayContaining([
      'J06.9',
      'Acute upper respiratory infection, unspecified',
      99,
      'tenant-1',
      12,
    ]));
    expect(visitUpdate?.sql.toLowerCase()).toContain('and not exists');
    expect(visitUpdate?.sql.toLowerCase()).toContain("diagnosistype = 'primary'");
    const diagnosisInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into clinicaldiagnosis')
    );
    expect(diagnosisInsert?.params).toContain(501);
    expect(diagnosisInsert?.params).toContain('J06.9');
    expect(diagnosisInsert?.sql.toLowerCase()).toContain('case when exists');
    expect(diagnosisInsert?.sql.toLowerCase()).toContain('where not exists');
  });

  it('maps an ICD-11 selection to visit and verified clinical diagnosis fields', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('from catalog_icd11_mms') && lower.includes('code = ?')) {
          return { first: { id: 801, code: 'CA40.Z', title: 'Pneumonia, unspecified' } };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        codedDiagnosis: {
          system: 'ICD-11',
          code: 'CA40.Z',
          description: 'Pneumonia',
        },
        completeVisit: false,
      },
    });

    expect(res.status).toBe(200);
    const visitUpdate = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('update visits')
      && query.sql.toLowerCase().includes('icd11_code')
    );
    expect(visitUpdate?.params).toContain('CA40.Z');
    expect(visitUpdate?.params).toContain('Pneumonia, unspecified');
    const diagnosisInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into clinicaldiagnosis')
    );
    expect(diagnosisInsert?.params).toContain('CA40.Z');
    expect(diagnosisInsert?.params).toContain('Pneumonia, unspecified');
  });

  it('rejects coded diagnosis attachment when the appointment has no patient visit', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: null,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        codedDiagnosis: {
          system: 'ICD-10',
          code: 'J06.9',
          description: 'Acute upper respiratory infection, unspecified',
        },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/patient visit/i) });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into clinicaldiagnosis'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('update appointments'))).toBe(false);
  });

  it('rejects an unknown coded diagnosis before writing clinical or lifecycle records', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from appointments a') && lower.includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              appt_date: '2026-05-17',
              visit_id: 99,
            },
          };
        }
        if (lower.includes('from icd10diseases') && lower.includes('icd10code = ?')) {
          return { first: null };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        codedDiagnosis: {
          system: 'ICD-10',
          code: 'J06.9',
          description: 'Unknown code in this catalog',
        },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(400);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into clinicaldiagnosis'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('update appointments'))).toBe(false);
  });

  it('does not report a completed consultation when the lifecycle transaction fails', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from appointments a') && sql.toLowerCase().includes('left join visits')) {
          return {
            first: {
              id: 44,
              patient_id: 12,
              doctor_id: 1,
              status: 'checked_in',
              billing_status: 'paid',
              visit_id: 99,
            },
          };
        }
        return null;
      },
      universalFallback: true,
    });
    mockDB.db.batch = async () => {
      throw new Error('lifecycle transaction failed');
    };
    const { app } = createTestApp({
      route: doctorRoutes,
      routePath: '/doctors',
      role: 'doctor',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/44/complete-consultation', {
      method: 'POST',
      body: {
        soap: {
          chiefComplaint: 'Fever',
          assessment: 'Acute febrile illness',
        },
        completeVisit: true,
      },
    });

    expect(res.status).toBe(500);
    const failedClaimUpdate = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes("set status = 'failed'")
      && query.sql.toLowerCase().includes('consultation_completion_claims')
    );
    expect(failedClaimUpdate?.params).toContain('UNEXPECTED_ERROR');
  });
});
