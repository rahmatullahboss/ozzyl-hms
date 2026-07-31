import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import patientPortalRoutes from '../../../src/routes/tenant/patientPortal';
import { createTestApp } from '../helpers/test-app';

describe('patient portal auth guard', () => {
  it('rejects non-global admin JWTs with a 403 patient portal message', async () => {
    const jwtSecret = 'test-secret-key-for-testing-only';
    const adminToken = await sign({
      userId: '101',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      permissions: ['*'],
    }, jwtSecret);

    const { app } = createTestApp({
      route: patientPortalRoutes,
      routePath: '/patient-portal',
      jwtSecret,
      tables: {},
    });

    const res = await app.request('/patient-portal/me', {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Patient portal access only');
  });
});
