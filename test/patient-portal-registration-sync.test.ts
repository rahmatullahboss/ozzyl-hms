import { describe, expect, it } from 'vitest';
import patientPortalRoutes from '../src/routes/tenant/patientPortal';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('patient portal registration local-sync coverage', () => {
  it('atomically creates the patient and outbox with required demographic defaults', async () => {
    const { app, mockDB } = createTestApp({
      route: patientPortalRoutes,
      routePath: '/patient-portal',
      tenantId: 'tenant-1',
      queryOverride(sql, params) {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.includes('from patients') && normalized.includes('where email = ?')) {
          return { first: null, results: [], success: true, meta: {} };
        }
        if (normalized.startsWith('insert into sequence_counters')) {
          return {
            first: { current_value: 42 },
            results: [{ current_value: 42 }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_portal_credentials')) {
          return { first: null, results: [], success: true, meta: {} };
        }
        if (normalized.includes('select name from tenants')) {
          return { first: { name: 'Test Hospital' }, results: [{ name: 'Test Hospital' }], success: true, meta: {} };
        }
        return null;
      },
      extraEnv: {
        ENVIRONMENT: 'local_server',
        LOCAL_SERVER_ID: 'hospital-lan-primary',
      },
    });

    const response = await jsonRequest(app, '/patient-portal/register', {
      method: 'POST',
      body: {
        name: 'Portal Patient',
        email: 'Portal.Patient@example.test',
      },
    });

    expect(response.status).toBe(201);
    const atomicPatientBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /INSERT\s+INTO\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)),
    );
    expect(atomicPatientBatch).toBeDefined();

    const patientInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInsert?.sql).toMatch(/father_husband/i);
    expect(patientInsert?.params).toContain('P-000042');
    expect(patientInsert?.params).toContain('portal.patient@example.test');
    expect(patientInsert?.params.filter((value) => value === '').length).toBeGreaterThanOrEqual(2);
  });

  it('reuses an existing tenant patient without creating another patient or outbox event', async () => {
    const { app, mockDB } = createTestApp({
      route: patientPortalRoutes,
      routePath: '/patient-portal',
      tenantId: 'tenant-1',
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.includes('from patients') && normalized.includes('where email = ?')) {
          return {
            first: { id: 55, name: 'Existing Patient', email: 'existing@example.test' },
            results: [{ id: 55, name: 'Existing Patient', email: 'existing@example.test' }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_portal_credentials')) {
          return { first: { id: 5 }, results: [{ id: 5 }], success: true, meta: {} };
        }
        return null;
      },
      extraEnv: {
        ENVIRONMENT: 'local_server',
        LOCAL_SERVER_ID: 'hospital-lan-primary',
      },
    });

    const response = await jsonRequest(app, '/patient-portal/register', {
      method: 'POST',
      body: {
        name: 'Existing Patient',
        email: 'existing@example.test',
      },
    });

    expect(response.status).toBe(201);
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+patients/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /local_sync_outbox/i.test(query.sql))).toBe(false);
  });
});
