import { describe, expect, it } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function makePrescriptionDB(linkedDoctorId = 4) {
  return createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      const lower = sql.toLowerCase();

      if (lower.includes('from doctors') && lower.includes('user_id')) {
        return { first: { id: linkedDoctorId }, results: [{ id: linkedDoctorId }] };
      }

      if (
        lower.includes('patient_allergies')
        || lower.includes('patient_active_medications')
        || lower.includes('patient_recently_stopped_medications')
        || lower.includes('drug_interaction_pairs')
        || lower.includes('formulary')
      ) {
        return { results: [] };
      }

      return null;
    },
  });
}

describe('prescription finalization integrity', () => {
  it('snapshots and synchronizes medicines when a prescription is initially issued as final', async () => {
    const mockDB = makePrescriptionDB();
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 88,
        doctorId: 4,
        status: 'final',
        diagnosis: 'Hypertension',
        items: [{
          medicine_name: 'Amlodipine',
          dosage: '5 mg',
          frequency: 'Once daily',
          duration: '30 days',
        }],
      },
    });

    expect(res.status).toBe(201);
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).toContain("set status = 'final'");
    expect(sql).toContain('prescription_versions');
    expect(sql).toContain('patient_active_medications');
    const activeMedicationInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert or ignore into patient_active_medications')
    );
    expect(activeMedicationInsert?.sql.toLowerCase()).toContain('dosage');
    expect(activeMedicationInsert?.sql.toLowerCase()).not.toMatch(/\bdose\b/);
  });

  it('rejects a doctor attempting to prescribe under another doctor identity', async () => {
    const mockDB = makePrescriptionDB(4);
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 88,
        doctorId: 99,
        status: 'draft',
        items: [],
      },
    });

    expect(res.status).toBe(403);
  });

  it('rejects a non-clinical initial status supplied by a client', async () => {
    const mockDB = makePrescriptionDB();
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 88,
        doctorId: 4,
        status: 'dispensed',
        items: [],
      },
    });

    expect(res.status).toBe(400);
  });

  it('snapshots the stored clinical prescription when a saved draft is finalized by partial update', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 4 }, results: [{ id: 4 }] };
        }
        if (lower.includes('from prescriptions') && lower.includes('where id = ?')) {
          return {
            first: {
              id: 9,
              rx_no: 'RX-9',
              status: 'draft',
              patient_id: 88,
              doctor_id: 4,
              is_locked: 0,
              diagnosis: 'Stored hypertension diagnosis',
              chief_complaint: 'Stored headache complaint',
              advice: 'Stored low salt advice',
              bp: '150/95',
              lab_tests: '["CBC"]',
              follow_up_date: '2026-06-01',
            },
            results: [],
          };
        }
        if (lower.includes('from prescription_items')) {
          return {
            results: [{
              medicine_name: 'Amlodipine',
              dosage: '5 mg',
              frequency: 'Once daily',
              duration: '30 days',
            }],
          };
        }
        if (
          lower.includes('patient_allergies')
          || lower.includes('patient_active_medications')
          || lower.includes('patient_recently_stopped_medications')
          || lower.includes('drug_interaction_pairs')
          || lower.includes('formulary')
        ) {
          return { results: [] };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/9', {
      method: 'PUT',
      body: { status: 'final' },
    });

    expect(res.status).toBe(200);
    const versionInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into prescription_versions')
    );
    const snapshot = JSON.parse(String(versionInsert?.params[1]));
    expect(snapshot).toMatchObject({
      id: 9,
      rx_no: 'RX-9',
      diagnosis: 'Stored hypertension diagnosis',
      chief_complaint: 'Stored headache complaint',
      advice: 'Stored low salt advice',
      bp: '150/95',
      follow_up_date: '2026-06-01',
      items: [{
        medicine_name: 'Amlodipine',
        dosage: '5 mg',
        frequency: 'Once daily',
        duration: '30 days',
      }],
    });
  });

  it('persists verified formulary mapping and prescribed quantity for optional dispensing', async () => {
    const mockDB = makePrescriptionDB();
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 88,
        doctorId: 4,
        status: 'draft',
        items: [{
          medicine_name: 'Amlodipine 5 mg',
          medicineId: 501,
          quantity: 30,
          frequency: 'Once daily',
        }],
      },
    });

    expect(res.status).toBe(201);
    const itemInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into')
      && query.sql.toLowerCase().includes('prescription_items')
    );
    expect(itemInsert?.sql.toLowerCase()).toContain('medicine_id');
    expect(itemInsert?.sql.toLowerCase()).toContain('quantity');
    expect(itemInsert?.params).toContain(501);
    expect(itemInsert?.params).toContain(30);
  });

  it('rejects zero prescribed quantity instead of creating an unusable mapped item', async () => {
    const mockDB = makePrescriptionDB();
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 88,
        doctorId: 4,
        items: [{
          medicine_name: 'Amlodipine 5 mg',
          medicineId: 501,
          quantity: 0,
        }],
      },
    });

    expect(res.status).toBe(400);
  });

  it('rejects a doctor editing a draft prescription owned by another doctor', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 4 }, results: [{ id: 4 }] };
        }
        if (lower.includes('from prescriptions') && lower.includes('where id = ?')) {
          return {
            first: { id: 9, status: 'draft', patient_id: 88, doctor_id: 7, is_locked: 0 },
            results: [{ id: 9, status: 'draft', patient_id: 88, doctor_id: 7, is_locked: 0 }],
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/9', {
      method: 'PUT',
      body: { diagnosis: 'Changed by non-owner' },
    });

    expect(res.status).toBe(403);
  });

  it('rejects a doctor auto-saving a draft prescription owned by another doctor', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      queryOverride(sql) {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 4 }, results: [{ id: 4 }] };
        }
        if (lower.includes('from prescriptions') && lower.includes('where id = ?')) {
          return {
            first: { id: 9, status: 'draft', doctor_id: 7, is_locked: 0 },
            results: [{ id: 9, status: 'draft', doctor_id: 7, is_locked: 0 }],
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 41,
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/9/auto-save', {
      method: 'POST',
      body: { diagnosis: 'Changed by non-owner' },
    });

    expect(res.status).toBe(403);
  });
});
