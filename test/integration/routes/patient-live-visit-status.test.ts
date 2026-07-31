import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import patientPortalRoutes from '../../../src/routes/tenant/patientPortal';
import { createTestApp } from '../helpers/test-app';

describe('patient live visit status route', () => {
  it('returns derived live queue details for the selected hospital', async () => {
    const jwtSecret = 'test-secret-key-for-testing-only';
    const token = await sign({
      userId: '1',
      scope: 'global',
      role: 'patient',
    }, jwtSecret);

    const { app } = createTestApp({
      route: patientPortalRoutes,
      routePath: '/patient-portal',
      jwtSecret,
      tables: {
        global_patient_auth: [{ id: 1, uhid: 'OZ-000123', phone: '01711000000', email: 'rahim@example.com', is_active: 1, auth_status: 'verified' }],
        patients: [{ id: 10, uhid: 'OZ-000123', national_id: '19901234567890123', mobile: '01711000000', email: 'rahim@example.com', tenant_id: 'tenant-1', name: 'Rahim Uddin' }],
        appointments: [{ id: 55, patient_id: 10, doctor_id: 8, appt_date: '2026-04-11', appt_time: '10:30', status: 'confirmed', token_no: 12, tenant_id: 'tenant-1', chief_complaint: 'Follow-up' }],
        visits: [{ id: 77, patient_id: 10, doctor_id: 8, visit_date: '2026-04-11', status: 'checked-in', tenant_id: 'tenant-1', updated_at: '2026-04-11T10:05:00Z' }],
        queue_entries: [
          { id: 91, patient_id: 99, doctor_id: 8, token_no: 'T009', token_number: 9, status: 'serving', queue_date: '2026-04-11', tenant_id: 'tenant-1' },
          { id: 92, patient_id: 10, doctor_id: 8, token_no: 'T012', token_number: 12, status: 'waiting', queue_date: '2026-04-11', tenant_id: 'tenant-1', estimated_wait_minutes: 24, counter_no: 'Room 3', updated_at: '2026-04-11T10:07:00Z' },
        ],
        doctors: [{ id: 8, name: 'Dr Ahmed', specialty: 'Medicine', tenant_id: 'tenant-1', is_active: 1 }],
        patient_hospital_link_verifications: [
          { id: 1, global_user_id: 1, patient_id: 10, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid', verified_at: '2026-04-01T00:00:00Z', revoked_at: null },
        ],
      },
      universalFallback: true,
    });

    const res = await app.request('/patient-portal/live-visit-status', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': 'tenant-1',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      live_visit: {
        status: string;
        queue: { token_no: string };
        patients_ahead: number;
        estimated_wait_minutes: number;
        visit: { status: string };
        journey: Array<{ key: string; state: string }>;
      };
    };

    expect(body.live_visit.status).toBe('waiting');
    expect(body.live_visit.queue.token_no).toBe('T012');
    expect(body.live_visit.patients_ahead).toBe(1);
    expect(body.live_visit.estimated_wait_minutes).toBe(24);
    expect(body.live_visit.visit.status).toBe('checked-in');
    expect(body.live_visit.journey.find((step) => step.key === 'checked_in')?.state).toBe('current');
  });
});
