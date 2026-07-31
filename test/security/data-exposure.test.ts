import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';
import patientRoutes from '../../src/routes/tenant/patients';

const TENANT_ID = 'tenant-1';

describe('Sensitive Data Exposure Prevention', () => {
  it('patient list does not expose password hashes', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/api',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
      tables: {
        patients: [{
          id: 1,
          tenant_id: TENANT_ID,
          name: 'Test Patient',
          phone: '01700000003',
          password_hash: '$2b$10$fakehashvalue',
        }],
      },
    });

    const res = await app.request('/api/patients', { method: 'GET' });
    if (res.status === 200) {
      const text = await res.text();
      expect(text).not.toContain('$2b$');
      expect(text).not.toContain('password_hash');
    }
    expect([200, 404]).toContain(res.status);
  });

  it('error responses do not leak stack traces', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/api',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {},
    });

    const res = await app.request('/api/patients/99999', { method: 'GET' });
    const text = await res.text();
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('/src/');
  });

  it('patient detail does not expose internal system fields', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/api',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        patients: [{
          id: 1,
          tenant_id: TENANT_ID,
          name: 'Test Patient',
          phone: '01700000004',
          jwt_secret: 'internal-secret-value',
        }],
      },
    });

    const res = await app.request('/api/patients/1', { method: 'GET' });
    if (res.status === 200) {
      const text = await res.text();
      expect(text).not.toContain('internal-secret-value');
    }
  });
});
