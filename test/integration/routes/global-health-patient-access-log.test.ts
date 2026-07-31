import { describe, expect, it } from 'vitest';
import globalHealthRoutes from '../../../src/routes/tenant/globalHealth';
import { createMockDB } from '../helpers/mock-db';
import { createTestApp } from '../helpers/test-app';

describe('global health access log for global patient auth', () => {
  it('resolves patient national id from global patient auth and returns access log', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from global_patient_auth')) {
          return {
            first: { national_id: '1990123456789', uhid: 'OZ-000123' },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patients where tenant_id = ? and national_id = ?')) {
          return {
            first: { id: 44, national_id: '1990123456789' },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from health_record_access_log')) {
          return {
            results: [{
              id: 1,
              access_type: 'portal_view',
              accessed_at: '2026-04-10T00:00:00Z',
              source_hospital: 'Demo Hospital',
              accessing_hospital: 'Demo Hospital',
              accessing_user_id: 1,
            }],
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: globalHealthRoutes,
      routePath: '/api/global-health',
      mockDB,
      role: 'patient',
      tenantId: '100',
      userId: 1,
    });

    const response = await app.request('/api/global-health/access-log');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      access_log: [
        {
          id: 1,
          access_type: 'portal_view',
          accessed_at: '2026-04-10T00:00:00Z',
          source_hospital: 'Demo Hospital',
          accessing_hospital: 'Demo Hospital',
          accessing_user_id: 1,
        },
      ],
    });
  });

  it('returns an empty access log when the patient is not yet linked in the tenant', async () => {
    const missingLegacyTableError = new Error('no such table: patient_portal_credentials');
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from global_patient_auth')) {
          return {
            first: { national_id: null, uhid: 'OZ-000999' },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from global_patient_identity where uhid = ?')) {
          return {
            first: { national_id: null },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patients where tenant_id = ? and national_id = ?')) {
          return {
            first: null,
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patient_portal_credentials')) {
          throw missingLegacyTableError;
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: globalHealthRoutes,
      routePath: '/api/global-health',
      mockDB,
      role: 'patient',
      tenantId: '100',
      userId: 2,
    });

    const response = await app.request('/api/global-health/access-log');
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ access_log: [] });
  });
});
