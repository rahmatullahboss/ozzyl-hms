import { describe, expect, it } from 'vitest';
import doctorCertificateRoutes from '../src/routes/tenant/doctorCertificates';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function makeApp(role: string) {
  const mockDB = createMockDB({
    queryOverride(sql) {
      const normalized = sql.toLowerCase();
      if (normalized.includes('from doctors') && normalized.includes('user_id')) {
        return { first: { id: 7, tenant_id: 'tenant-1', is_active: 1 } };
      }
      if (normalized.includes('from patients') && normalized.includes('tenant_id')) {
        return { first: { id: 9, tenant_id: 'tenant-1', name: 'Rahim Uddin' } };
      }
      if (normalized.includes('from doctor_certificates') && normalized.includes('status')) {
        return { first: { id: 42, tenant_id: 'tenant-1', doctor_id: 7, status: 'final' } };
      }
      if (normalized.includes('from doctor_certificates dc') && normalized.includes('dc.id = ?')) {
        return { first: { id: 42, tenant_id: 'tenant-1', doctor_id: 7, status: 'final' } };
      }
      return null;
    },
  });
  return {
    ...createTestApp({
      route: doctorCertificateRoutes,
      routePath: '/doctor-certificates',
      role,
      tenantId: 'tenant-1',
      userId: 33,
      mockDB,
    }),
    mockDB,
  };
}

const validCertificate = {
  patientId: 9,
  certificateType: 'medical',
  issueDate: '2026-05-27',
  recommendation: 'Rest advised for three days.',
  restDays: 3,
};

describe('doctor certificate audit and immutability', () => {
  it('does not allow a non-doctor to issue a clinical certificate', async () => {
    const { app } = makeApp('nurse');

    const response = await jsonRequest(app, '/doctor-certificates', {
      method: 'POST',
      body: validCertificate,
    });

    expect(response.status).toBe(403);
  });

  it('issues an immutable final certificate for the authenticated doctor and records an audit event', async () => {
    const { app, mockDB } = makeApp('doctor');

    const response = await jsonRequest(app, '/doctor-certificates', {
      method: 'POST',
      body: validCertificate,
    });

    expect(response.status).toBe(201);
    const body = await response.json() as { id: number; status: string; certificateNo: string };
    expect(body.status).toBe('final');
    expect(body.certificateNo).toMatch(/^MED-2026-/);
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO doctor_certificates'))).toBe(true);
    expect(mockDB.queries.some((query) => query.sql.includes('INSERT INTO audit_logs'))).toBe(true);
  });

  it('does not expose an edit endpoint for an issued certificate', async () => {
    const { app } = makeApp('doctor');

    const response = await jsonRequest(app, '/doctor-certificates/42', {
      method: 'PUT',
      body: { recommendation: 'Changed after print' },
    });

    expect(response.status).toBe(404);
  });

  it('returns an issued certificate through a tenant and issuing-doctor scoped lookup', async () => {
    const { app, mockDB } = makeApp('doctor');

    const response = await app.request('/doctor-certificates/42');

    expect(response.status).toBe(200);
    const lookup = mockDB.queries.find((query) => query.sql.includes('FROM doctor_certificates dc') && query.sql.includes('dc.id = ?'));
    expect(lookup?.params).toEqual([42, 'tenant-1', 7]);
  });

  it('requires a cancellation reason before cancelling a final certificate', async () => {
    const { app } = makeApp('doctor');

    const response = await jsonRequest(app, '/doctor-certificates/42/cancel', {
      method: 'POST',
      body: { reason: '' },
    });

    expect(response.status).toBe(400);
  });
});
