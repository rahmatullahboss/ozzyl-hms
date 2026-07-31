import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import patientPortalRoutes from '../../../src/routes/tenant/patientPortal';
import { createTestApp } from '../helpers/test-app';

describe('patient appointments sync route', () => {
  it('returns the patient appointment list successfully', async () => {
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
          { id: 92, patient_id: 10, doctor_id: 8, token_no: 'T012', token_number: 12, status: 'called', queue_date: '2026-04-11', tenant_id: 'tenant-1', estimated_wait_minutes: 4, counter_no: 'Room 3', updated_at: '2026-04-11T10:07:00Z' },
        ],
        doctors: [{ id: 8, name: 'Dr Ahmed', specialty: 'Medicine', tenant_id: 'tenant-1', is_active: 1 }],
        patient_hospital_link_verifications: [
          { id: 1, global_user_id: 1, patient_id: 10, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid' },
        ],
      },
      universalFallback: true,
    });

    const res = await app.request('/patient-portal/appointments?limit=5', {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': 'tenant-1',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{
        id: number;
        status: string;
      }>;
    };

    expect(body.data[0]?.id).toBe(55);
    expect(body.data[0]?.status).toBe('confirmed');
  });
});
