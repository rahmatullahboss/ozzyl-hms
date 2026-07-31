import { describe, expect, it } from 'vitest';
import appointmentRoutes from '../../../src/routes/tenant/appointments';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const TENANT_ID = 'tenant-1';
const doctorWithFee = {
  id: 1,
  tenant_id: TENANT_ID,
  doctorId: 1,
  name: 'Dr Khan',
  consultation_fee: 500,
  is_active: 1,
};

describe('appointment fee pricing', () => {
  it('uses appointment type fee setup and stores discounted final payable server-side', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors')) {
          return {
            first: { id: 1, name: 'Dr Khan', specialty: 'Medicine', department: 'OPD', consultation_fee: 500 },
            results: [{ id: 1, name: 'Dr Khan', specialty: 'Medicine', department: 'OPD', consultation_fee: 500 }],
          };
        }
        if (s.includes('from doctor_appointment_fees')) {
          return { first: { fee: 300 }, results: [{ fee: 300 }] };
        }
        return null;
      },
      tables: {
        appointments: [],
        doctors: [doctorWithFee],
        doctor_appointment_fees: [{
          tenant_id: TENANT_ID,
          doctor_id: 1,
          appointment_type: 'follow_up',
          fee: 300,
          is_active: 1,
        }],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 1,
        doctorId: 1,
        apptDate: '2026-05-10',
        visitType: 'followup',
        appointmentType: 'follow_up',
        discountAmount: 100,
        discountReason: 'Owner approved',
        discountByName: 'Owner',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      appointmentType: string;
      originalFee: number;
      discountAmount: number;
      consultationFee: number;
      billingStatus: string;
    };
    expect(body).toMatchObject({
      appointmentType: 'follow_up',
      originalFee: 300,
      discountAmount: 100,
      consultationFee: 200,
      billingStatus: 'unpaid',
    });

    const appointmentInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+"?appointments"?/i.test(query.sql),
    );
    expect(appointmentInsert?.params).toContain('follow_up');
    expect(appointmentInsert?.params).toContain(300);
    expect(appointmentInsert?.params).toContain(100);
    expect(appointmentInsert?.params).toContain(200);

    const provisionalInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+billing_provisional_items/i.test(query.sql),
    );
    expect(provisionalInsert?.params).toContain(300);
    expect(provisionalInsert?.params).toContain(100);
    expect(provisionalInsert?.params).toContain(200);
  });

  it('uses emergency doctor fee setup and stores the appointment as an emergency visit', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors')) {
          return {
            first: { id: 1, name: 'Dr Khan', specialty: 'Medicine', department: 'ER', consultation_fee: 500 },
            results: [{ id: 1, name: 'Dr Khan', specialty: 'Medicine', department: 'ER', consultation_fee: 500 }],
          };
        }
        if (s.includes('from doctor_appointment_fees')) {
          return { first: { fee: 800 }, results: [{ fee: 800 }] };
        }
        return null;
      },
      tables: {
        appointments: [],
        doctors: [doctorWithFee],
        doctor_appointment_fees: [{
          tenant_id: TENANT_ID,
          doctor_id: 1,
          appointment_type: 'emergency',
          fee: 800,
          is_active: 1,
        }],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 1,
        doctorId: 1,
        apptDate: '2026-05-10',
        visitType: 'emergency',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      appointmentType: string;
      originalFee: number;
      consultationFee: number;
      billingStatus: string;
    };
    expect(body).toMatchObject({
      appointmentType: 'emergency',
      originalFee: 800,
      consultationFee: 800,
      billingStatus: 'unpaid',
    });

    const appointmentInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+"?appointments"?/i.test(query.sql),
    );
    expect(appointmentInsert?.params).toContain('emergency');
    expect(appointmentInsert?.params).toContain(800);
  });

  it('marks report-show appointments no-charge without creating a provisional bill item', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from doctors')) {
          return { first: { id: 1, consultation_fee: 500 }, results: [{ id: 1, consultation_fee: 500 }] };
        }
        return null;
      },
      tables: {
        appointments: [],
        doctors: [doctorWithFee],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 1,
        doctorId: 1,
        apptDate: '2026-05-10',
        visitType: 'followup',
        appointmentType: 'report_show',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { appointmentType: string; billingStatus: string; consultationFee: number };
    expect(body).toMatchObject({ appointmentType: 'report_show', billingStatus: 'no_charge', consultationFee: 0 });
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+billing_provisional_items/i.test(query.sql))).toBe(false);
  });

  it('uses the server-side doctor consultation fee when booking an appointment', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from doctors')) {
          return { first: { id: 1, consultation_fee: 500 }, results: [{ id: 1, consultation_fee: 500 }] };
        }
        return null;
      },
      tables: {
        appointments: [],
        doctors: [doctorWithFee],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 1,
        doctorId: 1,
        apptDate: '2026-05-10',
        visitType: 'opd',
        fee: 5,
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { billingStatus: string; consultationFee: number };
    expect(body.consultationFee).toBe(500);
    expect(body.billingStatus).toBe('unpaid');
    const appointmentInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+"?appointments"?/i.test(query.sql),
    );
    expect(appointmentInsert?.params).toContain(500);
    expect(appointmentInsert?.params).not.toContain(5);
    const provisionalInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+billing_provisional_items/i.test(query.sql),
    );
    expect(provisionalInsert).toBeDefined();
    expect(provisionalInsert?.params).toContain(500);
  });

  it('rejects unauthorized doctor fee setup changes', async () => {
    const { app } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_ID,
      tables: {
        doctors: [doctorWithFee],
      },
    });

    const res = await jsonRequest(app, '/appointments/fee-setup/1', {
      method: 'PUT',
      body: {
        fees: [
          { appointmentType: 'old_patient', fee: 450, isActive: true },
        ],
      },
    });

    expect(res.status).toBe(403);
  });

  it('saves old-patient and emergency fee setup only for a tenant doctor', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        doctors: [doctorWithFee],
        doctor_appointment_fees: [],
      },
    });

    const res = await jsonRequest(app, '/appointments/fee-setup/1', {
      method: 'PUT',
      body: {
        fees: [
          { appointmentType: 'old_patient', fee: 450, notes: 'Returning OPD', isActive: true },
          { appointmentType: 'emergency', fee: 900, notes: 'ER surcharge', isActive: true },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { count: number };
    expect(body.count).toBe(2);

    const feeWrites = mockDB.queries.filter((query) =>
      /INSERT\s+INTO\s+doctor_appointment_fees/i.test(query.sql),
    );
    expect(feeWrites).toHaveLength(2);
    expect(feeWrites[0].params).toContain('old_patient');
    expect(feeWrites[0].params).toContain(450);
    expect(feeWrites[1].params).toContain('emergency');
    expect(feeWrites[1].params).toContain(900);
  });

  it('does not create doctor fee setup for an unknown tenant doctor', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      tables: {
        doctors: [],
        doctor_appointment_fees: [],
      },
    });

    const res = await jsonRequest(app, '/appointments/fee-setup/999', {
      method: 'PUT',
      body: {
        fees: [
          { appointmentType: 'emergency', fee: 900, isActive: true },
        ],
      },
    });

    expect(res.status).toBe(404);
    expect(mockDB.queries.some((query) =>
      /INSERT\s+INTO\s+doctor_appointment_fees/i.test(query.sql),
    )).toBe(false);
  });

  it('normalizes legacy minor-unit doctor fees before appointment pricing', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        if (sql.toLowerCase().includes('from doctors')) {
          return { first: { id: 1, consultation_fee: 50000 }, results: [{ id: 1, consultation_fee: 50000 }] };
        }
        return null;
      },
      tables: {
        appointments: [],
        doctors: [{ ...doctorWithFee, consultation_fee: 50000 }],
      },
    });

    const res = await jsonRequest(app, '/appointments', {
      method: 'POST',
      body: {
        patientId: 1,
        doctorId: 1,
        apptDate: '2026-05-10',
        visitType: 'opd',
      },
    });

    expect(res.status).toBe(201);
    const appointmentInsert = mockDB.queries.find((query) =>
      /INSERT\s+INTO\s+"?appointments"?/i.test(query.sql),
    );
    expect(appointmentInsert?.params).toContain(500);
    expect(appointmentInsert?.params).not.toContain(50000);
  });

  it('recalculates appointment fee from the existing doctor instead of trusting manual edits', async () => {
    const { app, mockDB } = createTestApp({
      route: appointmentRoutes,
      routePath: '/appointments',
      role: 'receptionist',
      tenantId: TENANT_ID,
      queryOverride(sql) {
        const s = sql.toLowerCase();
        if (s.includes('from doctors')) {
          return { first: { id: 1, consultation_fee: 500 }, results: [{ id: 1, consultation_fee: 500 }] };
        }
        if (s.includes('from "appointments"')) {
          return {
            first: {
              id: 10,
              tenant_id: TENANT_ID,
              tenantId: TENANT_ID,
              patient_id: 1,
              patientId: 1,
              doctor_id: 1,
              doctorId: 1,
              appt_date: '2026-05-10',
              apptDate: '2026-05-10',
              appt_time: '10:00',
              apptTime: '10:00',
              visit_type: 'opd',
              visitType: 'opd',
              status: 'scheduled',
              fee: 5,
            },
            results: [{
              id: 10,
              tenant_id: TENANT_ID,
              tenantId: TENANT_ID,
              patient_id: 1,
              patientId: 1,
              doctor_id: 1,
              doctorId: 1,
              appt_date: '2026-05-10',
              apptDate: '2026-05-10',
              appt_time: '10:00',
              apptTime: '10:00',
              visit_type: 'opd',
              visitType: 'opd',
              status: 'scheduled',
              fee: 5,
            }],
          };
        }
        return null;
      },
      tables: {
        appointments: [{
          id: 10,
          tenant_id: TENANT_ID,
          tenantId: TENANT_ID,
          patient_id: 1,
          patientId: 1,
          doctor_id: 1,
          doctorId: 1,
          appt_date: '2026-05-10',
          apptDate: '2026-05-10',
          appt_time: '10:00',
          apptTime: '10:00',
          visit_type: 'opd',
          visitType: 'opd',
          status: 'scheduled',
          fee: 5,
        }],
        doctors: [doctorWithFee],
      },
    });

    const res = await jsonRequest(app, '/appointments/10', {
      method: 'PUT',
      body: { fee: 5 },
    });

    expect(res.status).toBe(200);
    const appointmentUpdate = mockDB.queries.find((query) =>
      /UPDATE\s+"?appointments"?/i.test(query.sql),
    );
    expect(appointmentUpdate?.params).toContain(500);
    expect(appointmentUpdate?.params).not.toContain(5);
  });
});
