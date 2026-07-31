import { describe, expect, it } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('prescription clinical read access', () => {
  it.each([
    '',
    '/history?patientId=1',
    '/1',
    '/1/print',
    '/1/versions',
    '/1/overrides',
    '/1/repeat',
  ])('does not expose clinical prescription route %s to an accounting role', async (path) => {
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'accountant',
    });

    const res = await jsonRequest(app, `/prescriptions${path}`);

    expect(res.status).toBe(403);
  });

  it('does not expose prescription detail to a laboratory role', async () => {
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'laboratory',
    });

    expect((await jsonRequest(app, '/prescriptions/1')).status).toBe(403);
  });

  it('retains prescription list access for the reception prescription workflow', async () => {
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'reception',
    });

    const res = await jsonRequest(app, '/prescriptions');

    expect(res.status).toBe(200);
  });

  it('denies prescription detail to a doctor who does not own the prescription', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors') && s.includes('user_id')) {
          return { first: { id: 99 } };
        }
        if (s.includes('from prescriptions p')) {
          return { first: { id: 1, patient_id: 1, doctor_id: 12, status: 'final', tenant_id: 'tenant-1' } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      userId: 42,
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1');

    expect(res.status).toBe(403);
  });

  it('denies lab-order creation from prescription to non-clinical roles', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from prescriptions') && s.includes('lab_tests')) {
          return { first: { id: 1, patient_id: 1, doctor_id: 12, lab_tests: JSON.stringify(['CBC']), tenant_id: 'tenant-1' } };
        }
        if (s.includes('from lab_test_catalog')) {
          return { results: [{ id: 5, name: 'CBC' }] };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'accountant',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/create-lab-order', { method: 'POST' });

    expect(res.status).toBe(403);
  });
});
