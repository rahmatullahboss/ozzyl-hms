import { describe, expect, it } from 'vitest';
import appointmentRoutes from '../../../src/routes/tenant/appointments';
import visitRoutes from '../../../src/routes/tenant/visits';
import { getTodayGMT6 } from '../../../src/lib/date-utils';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';
const today = getTodayGMT6();

const doctor = {
  id: 11,
  tenant_id: TENANT_ID,
  name: 'Dr Visit Guard',
  specialty: 'Medicine',
  department: 'Medicine',
  consultation_fee: 0,
  is_active: 1,
};

const scheduledAppointment = {
  id: 81,
  appointment_id: 81,
  tenant_id: TENANT_ID,
  tenantId: TENANT_ID,
  patient_id: 41,
  patientId: 41,
  doctor_id: doctor.id,
  doctorId: doctor.id,
  appt_no: 'APT-000081',
  token_no: 1,
  appt_date: today,
  apptDate: today,
  appt_time: '10:00',
  visit_type: 'opd',
  visitType: 'opd',
  status: 'scheduled',
  fee: 0,
  billing_status: 'no_charge',
  billingStatus: 'no_charge',
  source: 'scheduled',
};

function appointmentSelectOverride(sql: string) {
  const normalized = sql.toLowerCase();
  if (normalized.includes('from "appointments"') || normalized.includes('from appointments')) {
    return {
      results: [{
        id: scheduledAppointment.id,
        appt_no: scheduledAppointment.appt_no,
        token_no: scheduledAppointment.token_no,
        patient_id: scheduledAppointment.patient_id,
        doctor_id: scheduledAppointment.doctor_id,
        appt_date: scheduledAppointment.appt_date,
        appt_time: scheduledAppointment.appt_time,
        visit_type: scheduledAppointment.visit_type,
        status: scheduledAppointment.status,
        notes: null,
        chief_complaint: null,
        fee: scheduledAppointment.fee,
        billing_status: scheduledAppointment.billing_status,
        created_by: 1,
        tenant_id: TENANT_ID,
        source: scheduledAppointment.source,
        checked_in_at: null,
        created_at: `${today} 09:00:00`,
        updated_at: `${today} 09:00:00`,
      }],
    };
  }
  return null;
}

describe('visit creation and appointment check-in guards', () => {
  it('rejects appointment check-in when the role cannot write appointments', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'doctor',
      tenantId: TENANT_ID,
      tables: {
        appointments: [scheduledAppointment],
        doctors: [doctor],
        visits: [],
        queue_entries: [],
      },
      queryOverride: appointmentSelectOverride,
    });

    const res = await jsonRequest(app, `/appointments/${scheduledAppointment.id}/check-in`, {
      method: 'POST',
    });

    expect(res.status).toBe(403);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+visits/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+queue_entries/i);
  });

  it('rejects direct visit creation when the role cannot write appointments', async () => {
    const { app, mockDB } = createTestApp({
      route: visitRoutes,
      routePath: '/visits',
      role: 'doctor',
      tenantId: TENANT_ID,
      tables: { visits: [] },
    });

    const res = await jsonRequest(app, '/visits', {
      method: 'POST',
      body: { patientId: 41, visitType: 'opd' },
    });

    expect(res.status).toBe(403);
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"?visits"?/i);
  });

  it('rejects direct duplicate same-patient same-doctor visit creation for today', async () => {
    const { app, mockDB } = createTestApp({
      route: visitRoutes,
      routePath: '/visits',
      role: 'receptionist',
      tenantId: TENANT_ID,
      tables: {
        doctors: [doctor],
        visits: [{
          id: 7001,
          tenant_id: TENANT_ID,
          patient_id: 41,
          doctor_id: doctor.id,
          visit_date: today,
          status: 'initiated',
          visit_no: 'V-007001',
        }],
      },
    });

    const res = await jsonRequest(app, '/visits', {
      method: 'POST',
      body: { patientId: 41, doctorId: doctor.id, visitType: 'opd' },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('same doctor today');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+"?visits"?/i);
  });

  it('rejects appointment check-in when the patient already has a same-doctor visit today', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_ID,
      tables: {
        appointments: [scheduledAppointment],
        doctors: [doctor],
        visits: [{
          id: 7001,
          tenant_id: TENANT_ID,
          patient_id: scheduledAppointment.patient_id,
          doctor_id: doctor.id,
          visit_date: today,
          status: 'initiated',
          visit_no: 'V-007001',
          appointment_id: null,
        }],
        queue_entries: [],
      },
      queryOverride: appointmentSelectOverride,
    });

    const res = await jsonRequest(app, `/appointments/${scheduledAppointment.id}/check-in`, {
      method: 'POST',
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('same doctor today');
    const sql = mockDB.queries.map((query) => query.sql).join('\n');
    expect(sql).not.toMatch(/INSERT\s+INTO\s+visits/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+queue_entries/i);
  });
});
