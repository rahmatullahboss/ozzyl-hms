import { describe, it, expect } from 'vitest';
import { createTestApp } from '../integration/helpers/test-app';
import globalPortalRoutes from '../../src/routes/global-portal';
import { sign } from 'hono/jwt';

describe('SQL Injection - Global Portal', () => {
  it('should not be vulnerable to SQL injection in buildPatientClause', async () => {
    const { app, mockDB } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/global-portal',
      role: 'patient',
      tenantId: 'tenant-1',
      universalFallback: true,
      tables: {
        global_patient_auth: [
          { id: 1, identity_id: 1, is_active: 1, national_id: '123' }
        ],
        global_patient_identity: [
          { id: 1, uhid: 'OZ-123', primary_name: 'Test', primary_phone: '123', primary_email: 'test@test.com' }
        ],
        patient_health_links: [
          { id: 1, identity_id: 1, tenant_id: "tenant-1' OR 1=1 --", patient_id: 1 }
        ]
      }
    });

    const token = await sign(
        { userId: 1, scope: 'global', role: 'patient' },
        'test-secret-key-for-testing-only',
        'HS256',
    );

    const res = await app.request('/global-portal/dashboard', {
        headers: {
            'x-global-user-id': '1',
            Authorization: `Bearer ${token}`
        }
    });

    const appointmentQueries = mockDB.queries.filter(q => q.sql.includes('FROM appointments'));

    expect(res.status).toBe(200);
    for (const q of appointmentQueries) {
        expect(q.sql).not.toContain("tenant-1' OR 1=1 --");
    }
  });
});
