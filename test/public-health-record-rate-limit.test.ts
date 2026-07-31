import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import publicHealthRecordRoutes from '../src/routes/public/healthRecord';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('public health record token rate limiting', () => {
  test('locks repeated invalid summary token lookups from the same IP', async () => {
    const mockDB = createMockDB();
    const { app } = createTestApp({
      route: publicHealthRecordRoutes as any,
      routePath: '/public',
      mockDB,
    });

    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await app.request(`/public/summary/${'x'.repeat(32)}`, {
        headers: {
          'CF-Connecting-IP': '198.51.100.10',
        },
      });
      expect(res.status).toBe(404);
    }

    const locked = await app.request(`/public/summary/${'x'.repeat(32)}`, {
      headers: {
        'CF-Connecting-IP': '198.51.100.10',
      },
    });

    expect(locked.status).toBe(429);
  });

  test('limits repeated access to the same valid summary token', async () => {
    const rawToken = 't'.repeat(40);
    const tokenHash = sha256(rawToken);
    const mockDB = createMockDB({
      tables: {
        health_record_access_tokens: [{
          id: 7,
          token_hash: tokenHash,
          national_id: '19901234567890123',
          tenant_id: 'tenant-1',
          patient_id: 50,
          scope: 'summary',
          is_active: 1,
          expires_at: '2099-12-31T00:00:00.000Z',
          access_count: 0,
        }],
        health_record_consents: [{
          id: 1,
          national_id: '19901234567890123',
          granting_tenant_id: 'tenant-1',
          is_active: 1,
          expires_at: '2099-12-31T00:00:00.000Z',
          consent_type: 'view_summary',
        }],
        patients: [{
          id: 50,
          tenant_id: 'tenant-1',
          name: 'Test Patient',
          age: 30,
          gender: 'female',
          blood_group: 'A+',
          date_of_birth: '1996-01-01',
          uhid: 'OZ-000050',
        }],
        tenants: [{
          id: 'tenant-1',
          name: 'Tenant Hospital',
        }],
        patient_allergies: [],
        CLN_ProblemList: [],
        patient_active_medications: [],
        ClinicalDiagnosis: [],
        clinical_vitals: [],
        patient_vaccinations: [],
        vaccine_master: [],
        lab_order_items: [],
        lab_orders: [],
        lab_test_catalog: [],
        discharge_summaries: [],
        health_record_access_log: [],
      },
    });

    const { app } = createTestApp({
      route: publicHealthRecordRoutes as any,
      routePath: '/public',
      mockDB,
    });

    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await app.request(`/public/summary/${rawToken}`, {
        headers: {
          'CF-Connecting-IP': '198.51.100.20',
        },
      });
      expect(res.status).toBe(200);
    }

    const limited = await app.request(`/public/summary/${rawToken}`, {
      headers: {
        'CF-Connecting-IP': '198.51.100.20',
      },
    });

    expect(limited.status).toBe(429);
  });
});
