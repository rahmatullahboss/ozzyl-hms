import { describe, expect, it } from 'vitest';
import appointmentRoutes from '../../../src/routes/tenant/appointments';
import { createTestApp, createTestAppNoRole, jsonRequest } from '../helpers/test-app';
import { DOCTOR_1, PATIENT_1, TENANT_1 } from '../helpers/fixtures';
import { createIdempotencyRequestHash } from '../../../src/lib/request-idempotency';

const futureAppointmentDate = '2026-06-15';

const existingAppointment = {
  id: 4101,
  tenant_id: TENANT_1.id,
  tenantId: TENANT_1.id,
  patient_id: PATIENT_1.id,
  patientId: PATIENT_1.id,
  doctor_id: DOCTOR_1.id,
  doctorId: DOCTOR_1.id,
  appt_no: 'APT-004101',
  apptNo: 'APT-004101',
  token_no: 1,
  tokenNo: 1,
  appt_date: futureAppointmentDate,
  apptDate: futureAppointmentDate,
  appt_time: '09:00',
  apptTime: '09:00',
  visit_type: 'opd',
  visitType: 'opd',
  status: 'scheduled',
  fee: DOCTOR_1.consultation_fee,
  billing_status: 'unpaid',
  billingStatus: 'unpaid',
  source: 'scheduled',
};

function buildAppointmentApp(options: {
  role?: string;
  appointments?: Record<string, unknown>[];
  queryOverride?: Parameters<typeof createTestApp>[0]['queryOverride'];
} = {}) {
  return createTestApp({
    route: appointmentRoutes,
    routePath: '/appointments',
    role: options.role ?? 'hospital_admin',
    tenantId: TENANT_1.id,
    userId: 1,
    tables: {
      patients: [PATIENT_1],
      doctors: [DOCTOR_1],
      appointments: options.appointments ?? [],
      billing_provisional_items: [],
    },
    queryOverride: options.queryOverride,
  });
}

describe('appointment booking hardening', () => {
  it('rejects appointment booking without an appointment write role', async () => {
    const { app } = createTestAppNoRole({
      route: appointmentRoutes,
      routePath: '/appointments',
      tenantId: TENANT_1.id,
      tables: {
        patients: [PATIENT_1],
        doctors: [DOCTOR_1],
        appointments: [],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        doctorId: DOCTOR_1.id,
        apptDate: futureAppointmentDate,
        apptTime: '10:00',
      },
    });

    expect(res.status).toBe(403);
  });

  it('rejects invalid appointment time with 400', async () => {
    const { app } = buildAppointmentApp();

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        doctorId: DOCTOR_1.id,
        apptDate: futureAppointmentDate,
        apptTime: '25:99',
      },
    });

    expect(res.status).toBe(400);
  });

  it('rejects impossible appointment date with 400', async () => {
    const { app } = buildAppointmentApp();

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        doctorId: DOCTOR_1.id,
        apptDate: '2026-02-30',
        apptTime: '10:00',
      },
    });

    expect(res.status).toBe(400);
  });

  it('replays a completed appointment creation idempotently without inserting again', async () => {
    const requestBody = {
      patientId: PATIENT_1.id,
      doctorId: DOCTOR_1.id,
      apptDate: futureAppointmentDate,
      apptTime: '10:00',
      visitType: 'opd' as const,
      discountAmount: 0,
      fee: 0,
      source: 'scheduled' as const,
      idempotencyKey: 'appointment-create-replay-001',
    };
    const requestHash = await createIdempotencyRequestHash({
      ...requestBody,
      force: false,
      idempotencyKey: undefined,
    });
    const existingResponse = {
      message: 'Appointment booked',
      id: 9901,
      apptNo: 'APT-009901',
      tokenNo: 7,
      appointmentType: 'new_patient',
      originalFee: 500,
      discountAmount: 0,
      consultationFee: 500,
      billingStatus: 'unpaid',
      discountByName: null,
    };
    const { app, mockDB } = buildAppointmentApp({
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'completed',
              response_json: JSON.stringify(existingResponse),
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: requestBody,
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ...existingResponse, idempotent: true });
    expect(mockDB.queries.some((query) => /insert\s+into\s+"?appointments"?/i.test(query.sql))).toBe(false);
  });

  it('rejects same patient and doctor duplicate appointment on the same day', async () => {
    const { app, mockDB } = buildAppointmentApp({
      appointments: [existingAppointment],
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('appt_time between')) {
          return { first: normalized.includes('count(*)') ? { cnt: 0, count: 0 } : null, results: [] };
        }
        if (
          normalized.includes('from appointments') &&
          normalized.includes('patient_id = ?') &&
          normalized.includes('doctor_id = ?') &&
          normalized.includes('appt_date = ?') &&
          params.includes(PATIENT_1.id) &&
          params.includes(DOCTOR_1.id) &&
          params.includes(futureAppointmentDate)
        ) {
          return { first: { id: existingAppointment.id }, results: [{ id: existingAppointment.id }] };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: PATIENT_1.id,
        doctorId: DOCTOR_1.id,
        apptDate: futureAppointmentDate,
        apptTime: '11:00',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { message?: string; conflictingAppointmentId?: number };
    expect(body.message).toMatch(/already has appointment/i);
    expect(body.conflictingAppointmentId).toBe(existingAppointment.id);
    expect(mockDB.queries.some((query) => /insert\s+into\s+"?appointments"?/i.test(query.sql))).toBe(false);
  });
});
