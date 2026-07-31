import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function makeDoctorApp() {
  const mockDB = createMockDB({
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes('from doctors') && s.includes('where tenant_id=? and canonical_source_key=?')) {
        return { first: { id: 6 } };
      }
      if (s.includes('from doctors') && s.includes('where id = ? and tenant_id = ?')) {
        if (params[1] !== 'tenant-1') return { first: null };
        return {
          first: {
            id: 5,
            tenant_id: 'tenant-1',
            name: 'Dr Existing',
            specialty: 'Cardiology',
            is_active: 1,
            consultation_fee: 500,
            photo_key: null,
          },
        };
      }
      return null;
    },
  });

  return createTestApp({
    route: doctorRoutes,
    routePath: '/doctors',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 42,
    mockDB,
  });
}

function auditQueries(mockDB: ReturnType<typeof createMockDB>) {
  return mockDB.queries.filter((q) =>
    q.sql.toLowerCase().includes('insert into audit_logs'),
  );
}

describe('doctor CRUD audit logging', () => {
  it('creates an INSERT audit log when a doctor is created', async () => {
    const { app, mockDB } = makeDoctorApp();

    const res = await jsonRequest(app, '/doctors', {
      method: 'POST',
      body: {
        name: 'Dr New',
        specialty: 'Neurology',
        consultationFee: 800,
      },
    });

    expect(res.status).toBe(201);

    const logs = auditQueries(mockDB);
    expect(logs).toHaveLength(1);
    expect(logs[0].params).toContain('CREATE');
    expect(logs[0].params).toContain('doctors');
    expect(logs[0].params).toContain('tenant-1');
    expect(logs[0].params).toContain(42);
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/INSERT INTO doctors/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_practitioners/i);
    expect(batch).toMatch(/INSERT INTO canonical_outbox_events/i);
  });

  it('creates an UPDATE audit log when a doctor is updated', async () => {
    const { app, mockDB } = makeDoctorApp();

    const res = await jsonRequest(app, '/doctors/5', {
      method: 'PUT',
      body: {
        name: 'Dr Updated',
        specialty: 'Orthopedics',
      },
    });

    expect(res.status).toBe(200);

    const logs = auditQueries(mockDB);
    expect(logs).toHaveLength(1);
    expect(logs[0].params).toContain('UPDATE');
    expect(logs[0].params).toContain('doctors');
    expect(logs[0].params).toContain(5);
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/UPDATE doctors SET name/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_practitioners/i);
    expect(batch).toMatch(/INSERT INTO canonical_outbox_events/i);
  });

  it('creates an UPDATE audit log when a doctor is deactivated', async () => {
    const { app, mockDB } = makeDoctorApp();

    const res = await app.request('/doctors/5/deactivate', { method: 'PUT' });
    expect(res.status).toBe(200);

    const logs = auditQueries(mockDB);
    expect(logs).toHaveLength(1);
    expect(logs[0].params).toContain('UPDATE');
    expect(logs[0].params).toContain('doctors');
    expect(logs[0].params).toContain(5);
    expect(mockDB.batchCalls).toHaveLength(1);
    const batch = mockDB.batchCalls[0].join('\n');
    expect(batch).toMatch(/UPDATE doctors SET is_active = 0/i);
    expect(batch).toMatch(/INSERT INTO audit_logs/i);
    expect(batch).toMatch(/INSERT INTO canonical_practitioners/i);
    expect(batch).toMatch(/INSERT INTO canonical_outbox_events/i);
  });

  it('creates an UPDATE audit log when a doctor is activated', async () => {
    const { app, mockDB } = makeDoctorApp();

    const res = await app.request('/doctors/5/activate', { method: 'PUT' });
    expect(res.status).toBe(200);

    const logs = auditQueries(mockDB);
    expect(logs).toHaveLength(1);
    expect(logs[0].params).toContain('UPDATE');
    expect(logs[0].params).toContain('doctors');
    expect(logs[0].params).toContain(5);
  });
});
