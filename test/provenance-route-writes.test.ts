import { describe, expect, it } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import allergies from '../src/routes/tenant/allergies';
import vitals from '../src/routes/tenant/vitals';
import testRoutes from '../src/routes/tenant/tests';
import labCatalogRoutes from '../src/routes/tenant/lab';
import nurseStation from '../src/routes/tenant/nurseStation';

describe('provenance write paths', () => {
  it('persists explicit allergy source when provided', async () => {
    const mockDB = createMockDB({
      tables: { patients: [{ id: 1, tenant_id: 'tenant-1', name: 'Patient One' }] },
      queryOverride(sql) {
        if (sql.includes('SELECT id FROM patient_allergies')) {
          return { first: null, success: true, meta: {} };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({ route: allergies, routePath: '/allergies', role: 'doctor', mockDB });

    const res = await jsonRequest(app, '/allergies', {
      method: 'POST',
      body: {
        patient_id: 1,
        allergy_type: 'drug',
        allergen: 'Penicillin',
        severity: 'severe',
        source: 'patient_reported',
      },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_allergies'));
    expect(insert?.params).toContain('patient_reported');
  });

  it('stores recorded provenance for clinical vitals', async () => {
    const mockDB = createMockDB({
      tables: { patients: [{ id: 1, tenant_id: 'tenant-1', name: 'Patient One' }] },
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from "patients"')) {
          return { results: [{ id: 1 }], success: true, meta: {} };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({ route: vitals, routePath: '/vitals', role: 'doctor', mockDB });

    const res = await jsonRequest(app, '/vitals', {
      method: 'POST',
      body: { patient_id: 1, pulse: 72 },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((q) => q.sql.includes('clinical_vitals'));
    expect(insert?.params).toContain('recorded');
  });

  it('stores recorded provenance for nurse-station vitals', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: nurseStation, routePath: '/nurse', role: 'nurse', mockDB });

    const res = await jsonRequest(app, '/nurse/vitals', {
      method: 'POST',
      body: { patient_id: 1, systolic: 120 },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_vitals'));
    expect(insert?.params).toContain('recorded');
  });

  it('stores lab provenance for legacy test orders', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({ route: testRoutes, routePath: '/tests', role: 'hospital_admin', mockDB });

    const res = await jsonRequest(app, '/tests', {
      method: 'POST',
      body: { patientId: 1, testName: 'CBC' },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO tests'));
    expect(insert?.params).toContain('lab');
  });

  it('stores lab provenance for lab order items', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        if (sql.includes('SELECT id, price FROM lab_test_catalog')) {
          return { first: { id: 3, price: 500 }, success: true, meta: {} };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({ route: labCatalogRoutes, routePath: '/lab', role: 'laboratory', mockDB });

    const res = await jsonRequest(app, '/lab/orders', {
      method: 'POST',
      body: { patientId: 1, items: [{ labTestId: 3, discount: 0 }] },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((q) => q.sql.includes('INSERT INTO lab_order_items'));
    expect(insert?.params).toContain('lab');
  });
});
