import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import visitPassRoutes from '../src/routes/tenant/visitPass';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('visit pass redeem', () => {
  it('redeems a visit pass and returns cross-hospital summaries for the current tenant', async () => {
    const rawToken = 'v'.repeat(40);
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patient_visit_passes where token_hash = ?')) {
          return {
            first: {
              id: 7,
              global_user_id: 5,
              uhid: 'OZ-12345',
              is_active: 1,
              expires_at: '2099-12-31T00:00:00.000Z',
              redeemed_by_tenant_id: null,
              redeemed_by_user_id: null,
              revoked_at: null,
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from health_record_consents where national_id = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
          const patientId = Number(params[0]);
          const tenantId = String(params[1]);
          return {
            first: {
              id: patientId,
              tenant_id: tenantId,
              name: tenantId === 'tenant-1' ? 'Patient A' : 'Patient B',
              age: 30,
              gender: 'female',
              blood_group: 'A+',
              date_of_birth: '1996-01-01',
              uhid: 'OZ-12345',
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('select name from tenants where id = ?')) {
          return {
            first: { name: String(params[0]) === 'tenant-1' ? 'Hospital One' : 'Hospital Two' },
            success: true,
            meta: {},
          };
        }

        return null;
      },
      tables: {
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', national_id: '19901234567890123', name: 'Patient A' },
          { id: 11, tenant_id: 'tenant-2', uhid: 'OZ-12345', national_id: '19901234567890123', name: 'Patient B' },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
          { id: 'tenant-2', name: 'Hospital Two' },
        ],
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

    const { app, mockDB: usedDB } = createTestApp({
      route: visitPassRoutes as any,
      routePath: '/api/visit-pass',
      role: 'doctor',
      tenantId: 'tenant-9',
      userId: 99,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/visit-pass/redeem', {
      method: 'POST',
      body: { token: rawToken },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      redeemed: boolean;
      scope: string;
      hospitals: Array<{ hospital_name: string; summary: unknown }>;
    };

    expect(body.redeemed).toBe(true);
    expect(body.scope).toBe('summary');
    expect(body.hospitals).toHaveLength(2);

    expect(usedDB.queries.some((q) => q.sql.includes('INSERT INTO health_record_consents'))).toBe(true);
    expect(usedDB.queries.some((q) => q.sql.includes('INSERT INTO health_record_access_log'))).toBe(true);
    expect(usedDB.queries.some((q) => q.sql.includes('UPDATE patient_visit_passes'))).toBe(true);
  });

  it('accepts a short pass code as well as a raw token', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from patient_visit_passes where code_hash = ?')) {
          return {
            first: {
              id: 7,
              global_user_id: 5,
              uhid: 'OZ-12345',
              is_active: 1,
              expires_at: '2099-12-31T00:00:00.000Z',
              redeemed_by_tenant_id: 'tenant-9',
              redeemed_by_user_id: 99,
              revoked_at: null,
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from health_record_consents where national_id = ?')) {
          return { first: { id: 1 }, success: true, meta: {} };
        }

        return null;
      },
      tables: {
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', national_id: '19901234567890123', name: 'Patient A' },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
        ],
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
      route: visitPassRoutes as any,
      routePath: '/api/visit-pass',
      role: 'doctor',
      tenantId: 'tenant-9',
      userId: 99,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/visit-pass/redeem', {
      method: 'POST',
      body: { pass_code: 'VP-ABCD23' },
    });

    expect(res.status).toBe(200);
  });
});
