import { describe, expect, it } from 'vitest';
import referralRoutes from '../src/routes/tenant/referrals';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function makeApp(role: string) {
  const mockDB = createMockDB({
    universalFallback: true,
    queryOverride(sql) {
      if (sql.toLowerCase().includes('from doctors') && sql.toLowerCase().includes('user_id')) {
        return { first: { id: 7, tenant_id: 'tenant-1', is_active: 1 } };
      }
      return null;
    },
  });
  return createTestApp({
    route: referralRoutes,
    routePath: '/referrals',
    role,
    tenantId: 'tenant-1',
    mockDB,
  });
}

describe('cross-hospital referral clinical access', () => {
  it('does not allow reception staff to read referral clinical information', async () => {
    const { app } = makeApp('reception');

    const res = await app.request('/referrals');

    expect(res.status).toBe(403);
  });

  it('does not allow a nurse to create a cross-hospital referral', async () => {
    const { app } = makeApp('nurse');

    const res = await jsonRequest(app, '/referrals', {
      method: 'POST',
      body: {
        to_tenant_id: 'tenant-2',
        patient_global_id: 'UHID-001',
        reason: 'Specialist consultation required',
      },
    });

    expect(res.status).toBe(403);
  });

  it('keeps doctor access available for authorized referral work', async () => {
    const { app } = makeApp('doctor');

    const res = await app.request('/referrals');

    expect(res.status).not.toBe(403);
  });

  it('binds a doctor-created referral to the authenticated doctor profile', async () => {
    const { app, mockDB } = makeApp('doctor');

    const res = await jsonRequest(app, '/referrals', {
      method: 'POST',
      body: {
        to_tenant_id: 'tenant-2',
        patient_global_id: 'UHID-001',
        referring_doctor_id: 999,
        reason: 'Specialist consultation required',
      },
    });

    expect(res.status).toBe(201);
    const insert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO cross_hospital_referrals'));
    expect(insert?.params[4]).toBe(7);
    const auditInsert = mockDB.queries.find((query) => query.sql.includes('INSERT INTO audit_logs'));
    expect(JSON.stringify(auditInsert?.params ?? [])).not.toContain('UHID-001');
  });
});
