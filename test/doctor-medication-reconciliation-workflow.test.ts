import { describe, expect, it } from 'vitest';
import { medicationReconciliationRoutes } from '../src/routes/tenant/nursing/medication-reconciliation';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function createReconciliationApp(
  queryOverride: Parameters<typeof createMockDB>[0]['queryOverride'],
) {
  const mockDB = createMockDB({ queryOverride });
  const { app } = createTestApp({
    route: medicationReconciliationRoutes,
    routePath: '/medication-reconciliation',
    role: 'doctor',
    tenantId: 'tenant-1',
    userId: 42,
    mockDB,
  });
  return { app, mockDB };
}

describe('doctor medication reconciliation workflow', () => {
  it('rejects reconciliation when the visit belongs to another patient', async () => {
    const { app } = createReconciliationApp((sql) => {
      if (sql.toLowerCase().includes('select patient_id from visits')) {
        return { first: { patient_id: 999 } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 20,
        reconciliation_type: 'admission',
      },
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/patient.*visit/i) });
  });

  it('imports admission medicines from the patient home-medication list without querying a missing route column', async () => {
    const { app, mockDB } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('select patient_id from visits')) {
        return { first: { patient_id: 10 } };
      }
      if (lower.includes('from cln_medication_reconciliation') && lower.includes("status = 'in_progress'")) {
        return { first: null };
      }
      if (lower.includes('from patient_active_medications')) {
        return {
          results: [{
            medication_name: 'Amlodipine',
            generic_name: 'Amlodipine',
            dose: '5 mg',
            route: null,
            frequency: 'once daily',
          }],
        };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 20,
        reconciliation_type: 'admission',
      },
    });

    expect(res.status).toBe(201);
    const homeMedicationQuery = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from patient_active_medications'));
    expect(homeMedicationQuery?.sql.toLowerCase()).toContain('null as route');
    const importedItem = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into cln_medication_reconciliation_items'));
    expect(importedItem?.params).toContain('home');
  });

  it('prevents a second in-progress reconciliation for the same transition', async () => {
    const { app } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('select patient_id from visits')) {
        return { first: { patient_id: 10 } };
      }
      if (lower.includes('from cln_medication_reconciliation') && lower.includes("status = 'in_progress'")) {
        return { first: { id: 77 } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 20,
        reconciliation_type: 'discharge',
      },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/already.*progress/i) });
  });

  it('prevents a concurrent duplicate when the pre-check passes but the atomic insert loses the race', async () => {
    const { app, mockDB } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('select patient_id from visits')) {
        return { first: { patient_id: 10 } };
      }
      if (lower.includes('from cln_medication_reconciliation') && lower.includes("status = 'in_progress'") && lower.trim().startsWith('select')) {
        return { first: null };
      }
      if (lower.trim().startsWith('insert into cln_medication_reconciliation')) {
        return { meta: { changes: 0 } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 20,
        reconciliation_type: 'discharge',
      },
    });

    expect(res.status).toBe(409);
    const insert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into cln_medication_reconciliation'));
    expect(insert?.sql.toLowerCase()).toContain('where not exists');
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(false);
  });

  it('audits reconciliation creation without storing medication details in the audit payload', async () => {
    const { app, mockDB } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('select patient_id from visits')) {
        return { first: { patient_id: 10 } };
      }
      if (lower.includes('from cln_medication_reconciliation') && lower.includes("status = 'in_progress'")) {
        return { first: null };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 20,
        reconciliation_type: 'admission',
        notes: 'Patient brought a medicine bag',
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
    const auditQuery = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into audit_logs'));
    expect(String(auditQuery?.params[6] ?? '')).not.toContain('medicine bag');
  });

  it('lets a doctor update an imported medication action while the reconciliation is open', async () => {
    const { app, mockDB } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from cln_medication_reconciliation') && !lower.includes('items')) {
        return { first: { id: 55, status: 'in_progress' } };
      }
      if (lower.includes('from cln_medication_reconciliation_items')) {
        return { first: { id: 9 } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation/55/items/9', {
      method: 'PUT',
      body: { action: 'discontinue', action_reason: 'Therapy completed' },
    });

    expect(res.status).toBe(200);
    const update = mockDB.queries.find((query) => query.sql.toLowerCase().includes('update cln_medication_reconciliation_items'));
    expect(update?.params).toContain('discontinue');
    expect(update?.params).toContain('Therapy completed');
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
  });

  it('requires a changed dose, route, or frequency for a modify decision', async () => {
    const { app } = createReconciliationApp(() => null);

    const res = await jsonRequest(app, '/medication-reconciliation/55/items/9', {
      method: 'PUT',
      body: { action: 'modify', action_reason: 'Adjust therapy' },
    });

    expect(res.status).toBe(400);
  });

  it('keeps completed reconciliations immutable instead of soft-deleting the clinical record', async () => {
    const { app } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from "cln_medication_reconciliation"')) {
        return { results: [{ id: 55, status: 'completed' }] };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation/55', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/locked/i) });
  });

  it('audits completion of an in-progress reconciliation', async () => {
    const { app, mockDB } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from cln_medication_reconciliation')) {
        return {
          first: {
            id: 55,
            status: 'in_progress',
            patient_id: 10,
            visit_id: 20,
            reconciliation_type: 'discharge',
          },
        };
      }
      if (lower.trim().startsWith('update cln_medication_reconciliation')) {
        return { meta: { changes: 1 } };
      }
      if (lower.includes('from admissions') && lower.includes('join visits')) {
        return { first: { id: 300 } };
      }
      if (lower.trim().startsWith('update discharge_checklists')) {
        return { meta: { changes: 1 } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation/55/complete', {
      method: 'PUT',
      body: {},
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      Results: { id: 55, status: 'completed', dischargeChecklistSynced: true },
    });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('update discharge_checklists')
      && query.params.includes(300),
    )).toBe(true);
  });

  it('returns a successful locked record when checklist sync fails after completion', async () => {
    const { app } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from cln_medication_reconciliation')) {
        return {
          first: {
            id: 55,
            status: 'in_progress',
            patient_id: 10,
            visit_id: 20,
            reconciliation_type: 'discharge',
          },
        };
      }
      if (lower.trim().startsWith('update cln_medication_reconciliation')) {
        return { meta: { changes: 1 } };
      }
      if (lower.includes('from admissions') && lower.includes('join visits')) {
        throw new Error('temporary checklist lookup failure');
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation/55/complete', {
      method: 'PUT',
      body: {},
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      Results: { id: 55, status: 'completed', dischargeChecklistSynced: false },
    });
  });

  it('rejects a concurrent second completion before checklist sync or audit', async () => {
    const { app, mockDB } = createReconciliationApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from cln_medication_reconciliation')) {
        return {
          first: {
            id: 55,
            status: 'in_progress',
            patient_id: 10,
            visit_id: 20,
            reconciliation_type: 'discharge',
          },
        };
      }
      if (lower.trim().startsWith('update cln_medication_reconciliation')) {
        return { meta: { changes: 0 } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/medication-reconciliation/55/complete', {
      method: 'PUT',
      body: {},
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('update discharge_checklists'))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(false);
  });
});
