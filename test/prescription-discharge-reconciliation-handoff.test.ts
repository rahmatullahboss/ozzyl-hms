import { describe, expect, it } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function createHandoffApp(options: {
  reconciliation?: Record<string, unknown> | null;
  admission?: Record<string, unknown> | null;
  existingPrescription?: Record<string, unknown> | null;
  insertError?: Error;
} = {}) {
  const mockDB = createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      const lower = sql.toLowerCase();

      if (lower.includes('from doctors') && lower.includes('user_id')) {
        return { first: { id: 4 }, results: [{ id: 4 }] };
      }
      if (lower.includes('from doctors') && lower.includes('where id = ?')) {
        return { first: { id: 4 }, results: [{ id: 4 }] };
      }
      if (lower.includes('from patients') && lower.includes('where id = ?')) {
        return { first: { id: 88 }, results: [{ id: 88 }] };
      }
      if (lower.includes('from admissions') && !lower.includes('cln_medication_reconciliation')) {
        const admission = options.admission === undefined
          ? { id: 300, patient_id: 88, admission_no: 'ADM-300', admission_date: '2026-07-01', discharge_date: null, status: 'admitted' }
          : options.admission;
        return { first: admission, results: admission ? [admission] : [] };
      }
      if (lower.includes('from cln_medication_reconciliation mr')) {
        const reconciliation = options.reconciliation === undefined ? { id: 71 } : options.reconciliation;
        return { first: reconciliation, results: reconciliation ? [reconciliation] : [] };
      }
      if (lower.includes('from prescriptions') && lower.includes('source_reconciliation_id')) {
        const existing = options.existingPrescription ?? null;
        return { first: existing, results: existing ? [existing] : [] };
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
      if (options.insertError && lower.includes('insert into') && lower.includes('prescriptions')) {
        throw options.insertError;
      }
      return null;
    },
  });

  const { app } = createTestApp({
    route: prescriptionRoutes,
    routePath: '/prescriptions',
    role: 'doctor',
    userId: 41,
    tenantId: 'tenant-1',
    mockDB,
  });
  return { app, mockDB };
}

const validBody = {
  patientId: 88,
  doctorId: 4,
  admissionId: 300,
  sourceReconciliationId: 71,
  status: 'draft' as const,
  items: [{
    medicine_name: 'Amlodipine',
    dosage: '10 mg',
    frequency: 'Once daily',
    duration: '30 days',
  }],
};

describe('discharge reconciliation prescription hand-off', () => {
  it('persists admission and reconciliation provenance on a reviewed prescription', async () => {
    const { app, mockDB } = createHandoffApp();

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: validBody,
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into')
      && query.sql.toLowerCase().includes('prescriptions')
      && !query.sql.toLowerCase().includes('prescription_items')
    );
    expect(insert?.sql.toLowerCase()).toContain('admission_id');
    expect(insert?.sql.toLowerCase()).toContain('source_reconciliation_id');
    expect(insert?.params).toContain(300);
    expect(insert?.params).toContain(71);
  });

  it('rejects a reconciliation that is not a completed discharge transition for the admission', async () => {
    const { app } = createHandoffApp({ reconciliation: null });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: validBody,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/completed discharge/i) });
  });

  it('rejects admission provenance when the admission does not belong to the patient', async () => {
    const { app } = createHandoffApp({ admission: null });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: validBody,
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/admission/i) });
  });

  it('rejects a second prescription for the same reconciliation', async () => {
    const { app } = createHandoffApp({
      existingPrescription: { id: 901, rx_no: 'RX-901', status: 'draft' },
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: validBody,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/already exists/i) });
  });

  it('requires admission provenance when a reconciliation source is supplied', async () => {
    const { app } = createHandoffApp();

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 88,
        doctorId: 4,
        sourceReconciliationId: 71,
        items: [],
      },
    });

    expect(res.status).toBe(400);
  });

  it('converts a unique-index race into a clinical duplicate conflict', async () => {
    const { app } = createHandoffApp({
      insertError: new Error('UNIQUE constraint failed: prescriptions.tenant_id, prescriptions.source_reconciliation_id'),
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: validBody,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/already exists/i) });
  });
});
