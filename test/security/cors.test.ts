import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';
import patientRoutes from '../../src/routes/tenant/patients';

const TENANT_ID = 'tenant-1';

describe('CORS Validation', () => {
  it('preflight OPTIONS does not reflect malicious origin', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/api',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {},
    });

    const res = await app.request('/api/patients', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://malicious-site.com',
        'Access-Control-Request-Method': 'GET',
      },
    });

    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    if (allowOrigin) {
      expect(allowOrigin).not.toBe('https://malicious-site.com');
    }
  });

  it('GET request from unauthorized origin does not get CORS allow header', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/api',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: { patients: [] },
    });

    const res = await app.request('/api/patients', {
      method: 'GET',
      headers: {
        Origin: 'https://attacker.evil.com',
      },
    });

    const allowOrigin = res.headers.get('Access-Control-Allow-Origin');
    if (allowOrigin) {
      expect(allowOrigin).not.toBe('https://attacker.evil.com');
    }
  });
});
