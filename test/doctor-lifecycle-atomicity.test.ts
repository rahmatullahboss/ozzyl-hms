import { describe, expect, it } from 'vitest';
import doctorRoutes from '../src/routes/tenant/doctors';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function createDoctorApp(queryOverride: (sql: string) => { first?: Record<string, unknown> | null } | null) {
  const mockDB = createMockDB({ queryOverride, universalFallback: true });
  mockDB.db.batch = async () => {
    throw new Error('lifecycle transaction failed');
  };
  const { app } = createTestApp({
    route: doctorRoutes,
    routePath: '/doctors',
    role: 'doctor',
    tenantId: 'tenant-1',
    userId: 42,
    mockDB,
  });
  return app;
}

describe('doctor dashboard lifecycle atomicity', () => {
  // These routes must fail the whole lifecycle mutation when their D1 batch fails.

  it('fails queue status update when the lifecycle batch fails', async () => {
    const app = createDoctorApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from doctors') && lower.includes('user_id')) return { first: { id: 10, name: 'Dr Current' } };
      if (lower.includes('from appointments') && lower.includes('doctor_id = ?')) {
        return { first: { id: 100, doctor_id: 10, patient_id: 50, status: 'checked_in' } };
      }
      return null;
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/100/status', {
      method: 'PUT',
      body: { status: 'in_progress' },
    });

    expect(res.status).toBe(500);
  });

  it('fails doctor reassignment when the lifecycle batch fails', async () => {
    const app = createDoctorApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from doctors') && lower.includes('user_id')) return { first: { id: 10, name: 'Dr Current' } };
      if (lower.includes('from appointments') && lower.includes('doctor_id = ?')) {
        return { first: { id: 100, doctor_id: 10, patient_id: 50, status: 'checked_in', appt_date: '2026-05-26', appt_time: null } };
      }
      if (lower.includes('from doctors') && lower.includes('is_active = 1')) return { first: { id: 20, name: 'Dr Target' } };
      return null;
    });

    const res = await jsonRequest(app, '/doctors/dashboard/appointments/100/reassign', {
      method: 'PUT',
      body: { doctorId: 20, reason: 'Covering duty' },
    });

    expect(res.status).toBe(500);
  });

  it('fails report-show review when the lifecycle batch fails', async () => {
    const app = createDoctorApp((sql) => {
      const lower = sql.toLowerCase();
      if (lower.includes('from appointments') && lower.includes('appointment_type')) {
        return { first: { id: 100, doctor_id: 10, status: 'checked_in', appointment_type: 'report_show' } };
      }
      if (lower.includes('from doctors') && lower.includes('user_id')) return { first: { id: 10 } };
      return null;
    });

    const res = await jsonRequest(app, '/doctors/dashboard/report-show/100/review', {
      method: 'POST',
      body: { notes: 'Reports reviewed' },
    });

    expect(res.status).toBe(500);
  });
});
