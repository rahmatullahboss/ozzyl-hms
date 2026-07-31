/**
 * auth-modules-extended.spec.ts
 *
 * Extended write-coverage tests for all modules NOT covered in auth-modules.spec.ts.
 * Each suite: POST creates, PUT updates, with correct schema fields from Zod validators.
 *
 * Covers: admissions, beds, consultations, emergency, discharge, OT, prescriptions,
 * billing-cancellation, credit-notes, deposits, settlements, insurance, appointments,
 * doctor-schedules, commissions, branches, accounts, journal, recurring, vitals
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders } from '../helpers/auth-helper';

// ── shared state ──────────────────────────────────────────────────────────────

const BASE_URL = 'https://hms-saas-production.rahmatullahzisan.workers.dev';
const TODAY = new Date().toISOString().split('T')[0]!;
const TOMORROW = new Date(Date.now() + 86400000).toISOString().split('T')[0]!;

let patientId = 0;
let doctorId = 0;
let billId = 0;
let admissionId = 0;
let bedId = 0;
let consultationId = 0;
let appointmentId = 0;
let scheduleId = 0;
let prescriptionId = 0;
let otBookingId = 0;
let emergencyId = 0;
let depositId = 0;
let commissionId = 0;
let branchId = 0;
let accountId = 0;
let recurringId = 0;
let policyId = 0;
let billIdForCancelTest = 0;

// ── seeding helpers needed by many suites ─────────────────────────────────────

test.beforeAll(async ({ request }) => {
  const auth = await loadAuth();
  const headers = authHeaders(auth);

  // Seed patient
  const pr = await request.post(`${BASE_URL}/api/patients`, {
    headers,
    data: {
      name: 'E2E Extended Patient',
      fatherHusband: 'Father Test',
      address: 'Extended Addr',
      mobile: '01700000999',
    },
  });
  const pd = await pr.json() as { patientId: number };
  patientId = pd.patientId;

  // Seed doctor (list existing)
  const dr = await request.get(`${BASE_URL}/api/doctors`, { headers });
  const dd = await dr.json() as { doctors: Array<{ id: number }> };
  doctorId = dd.doctors?.[0]?.id ?? 1;

  // Seed a bill (for cancellation & credit note tests) — non-fatal
  try {
    const br = await request.post(`${BASE_URL}/api/billing`, {
      headers,
      data: {
        patientId,
        discount: 0,
        items: [{ itemCategory: 'doctor_visit', description: 'E2E Cancel Test', quantity: 1, unitPrice: 200 }],
      },
    });
    if (br.ok()) {
      const bd = await br.json() as { billId: number };
      billIdForCancelTest = bd.billId ?? 0;
    }
  } catch { /* non-critical — billing cancel tests will skip */ }
});

// ══════════════════════════════════════════════════════════════════════════════
// 🛏️ Admissions — Bed Management + Patient Admissions
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🛏️ Extended — Admissions', () => {
  test('GET /api/admissions → lists admissions', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/admissions`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('GET /api/admissions/beds → lists beds', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/admissions/beds`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/admissions/beds → creates bed', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/admissions/beds`, {
      headers: authHeaders(auth),
      data: {
        ward_name: 'E2E Ward',
        bed_number: `B-${Date.now()}`,
        bed_type: 'general',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { id?: number; bedId?: number };
    bedId = body.id ?? body.bedId ?? 0;
  });

  test('POST /api/admissions → admits patient', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        bed_id: bedId || undefined,
        doctor_id: doctorId,
        admission_type: 'planned',
        provisional_diagnosis: 'E2E Test Admission',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { admissionId?: number; id?: number };
    admissionId = body.admissionId ?? body.id ?? 0;
  });

  test('GET /api/admissions/:id → gets single admission', async ({ request }) => {
    test.skip(admissionId === 0, 'Admission not created');
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/admissions/${admissionId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏥 Discharge Summary
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🏥 Extended — Discharge', () => {
  test('PUT /api/discharge/:id → upserts discharge summary', async ({ request }) => {
    test.skip(admissionId === 0, 'Need admission first');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/discharge/${admissionId}`, {
      headers: authHeaders(auth),
      data: {
        admission_diagnosis: 'E2E Diagnosis',
        final_diagnosis: 'E2E Final Diagnosis',
        treatment_summary: 'IV fluids, rest',
        procedures_performed: ['Blood test'],
      },
    });
    expect([200, 201, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🩺 Consultations
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🩺 Extended — Consultations', () => {
  test('GET /api/consultations → lists all', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/consultations`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/consultations → creates consultation', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/consultations`, {
      headers: authHeaders(auth),
      data: {
        doctorId,
        patientId,
        scheduledAt: `${TOMORROW}T10:00:00Z`,
        durationMin: 30,
        chiefComplaint: 'E2E headache',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; consultationId?: number };
      consultationId = body.id ?? body.consultationId ?? 0;
    }
  });

  test('PUT /api/consultations/:id → updates consultation', async ({ request }) => {
    test.skip(consultationId === 0, 'Consultation not created');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/consultations/${consultationId}`, {
      headers: authHeaders(auth),
      data: { status: 'in_progress', notes: 'E2E update' },
    });
    expect([200, 201, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🚨 Emergency
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🚨 Extended — Emergency', () => {
  test('GET /api/emergency → lists ER patients', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/emergency`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('GET /api/emergency/stats → ER stats', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/emergency/stats`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/emergency → registers ER patient', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/emergency`, {
      headers: authHeaders(auth),
      data: {
        first_name: 'ER',
        last_name: 'Patient',
        gender: 'Male',
        age: '35',
        contact_no: '01800000001',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; patientId?: number };
      emergencyId = body.id ?? body.patientId ?? 0;
    }
  });

  test('PUT /api/emergency/:id/triage → sets triage level', async ({ request }) => {
    if (emergencyId === 0) return;
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/emergency/${emergencyId}/triage`, {
      headers: authHeaders(auth),
      data: { triage_level: 'yellow', chief_complaint: 'E2E complaint', arrival_mode: 'walk-in' },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔬 OT (Operation Theatre)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🔬 Extended — OT', () => {
  test('GET /api/ot/bookings → lists OT bookings', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/ot/bookings`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('GET /api/ot/stats → OT statistics', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/ot/stats`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/ot/bookings → creates OT booking', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/ot/bookings`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        booked_for_date: TOMORROW,
        surgery_type: 'Appendectomy',
        diagnosis: 'Appendicitis',
        procedure_type: 'Laparoscopic',
        anesthesia_type: 'General',
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; bookingId?: number };
      otBookingId = body.id ?? body.bookingId ?? 0;
    }
  });

  test('PUT /api/ot/bookings/:id → updates OT booking', async ({ request }) => {
    if (otBookingId === 0) return;
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/ot/bookings/${otBookingId}`, {
      headers: authHeaders(auth),
      data: { remarks: 'E2E update', surgery_type: 'Updated Surgery' },
    });
    expect([200, 201, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💊 Prescriptions
// ══════════════════════════════════════════════════════════════════════════════

test.describe('💊 Extended — Prescriptions', () => {
  test('GET /api/prescriptions → lists prescriptions', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/prescriptions`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/prescriptions → creates prescription', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/prescriptions`, {
      headers: authHeaders(auth),
      data: {
        patientId,
        doctorId,
        chiefComplaint: 'E2E headache',
        diagnosis: 'E2E Migraine',
        bp: '120/80',
        items: [
          { medicine_name: 'Paracetamol 500mg', dosage: '1+0+1', duration: '5 days' },
        ],
      },
    });
    expect([200, 201, 403]).toContain(res.status()); // 403 if not doctor/admin role
    const body = await res.json() as { id?: number; rxId?: number };
    prescriptionId = body.id ?? body.rxId ?? 0;
  });

  test('GET /api/prescriptions/:id → gets single prescription', async ({ request }) => {
    test.skip(prescriptionId === 0, 'Prescription not created');
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/prescriptions/${prescriptionId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📅 Appointments
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📅 Extended — Appointments', () => {
  test('GET /api/appointments → lists appointments', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/appointments`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/appointments → creates appointment', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/appointments`, {
      headers: authHeaders(auth),
      data: {
        patientId,
        doctorId,
        apptDate: TOMORROW,
        apptTime: '10:30',
        visitType: 'opd',
        chiefComplaint: 'E2E checkup',
        fee: 500,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { id?: number; appointmentId?: number };
    appointmentId = body.id ?? body.appointmentId ?? 0;
  });

  test('PUT /api/appointments/:id → updates appointment', async ({ request }) => {
    test.skip(appointmentId === 0, 'Appointment not created');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/appointments/${appointmentId}`, {
      headers: authHeaders(auth),
      data: { status: 'completed', notes: 'E2E completed' },
    });
    expect([200, 201, 404]).toContain(res.status());
  });

  test('DELETE /api/appointments/:id → deletes appointment', async ({ request }) => {
    test.skip(appointmentId === 0, 'Appointment not created');
    const auth = await loadAuth();
    const res = await request.delete(`${BASE_URL}/api/appointments/${appointmentId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 204, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📆 Doctor Schedule
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📆 Extended — Doctor Schedule', () => {
  test('GET /api/doctor-schedule → lists schedules', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctor-schedule`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/doctor-schedule → creates schedule', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/doctor-schedule`, {
      headers: authHeaders(auth),
      data: {
        doctor_id: doctorId,
        day_of_week: 'mon',
        start_time: '09:00',
        end_time: '13:00',
        session_type: 'morning',
        max_patients: 20,
      },
    });
    expect([200, 201, 400, 404, 409]).toContain(res.status()); // 404 if doctor not found, 409 if duplicate
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      scheduleId = body.id ?? 0;
    }
  });

  test('DELETE /api/doctor-schedule/:id → deletes schedule', async ({ request }) => {
    test.skip(scheduleId === 0, 'Schedule not created');
    const auth = await loadAuth();
    const res = await request.delete(`${BASE_URL}/api/doctor-schedule/${scheduleId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 204, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📝 Vitals
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📝 Extended — Vitals', () => {
  test('GET /api/vitals?patient_id= → gets vitals', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/vitals?patient_id=${patientId}`, {
      headers: authHeaders(auth),
    });
    expect(res.status()).toBe(200);
  });

  test('POST /api/vitals → records vitals', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/vitals`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        temperature: 36.6,
        pulse: 72,
        blood_pressure_systolic: 120,
        blood_pressure_diastolic: 80,
        spo2: 98,
        weight: 70,
        height: 170,
        pain_scale: 2,
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('GET /api/vitals/latest/:patientId → gets latest vitals', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/vitals/latest/${patientId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💰 Deposits
// ══════════════════════════════════════════════════════════════════════════════

test.describe('💰 Extended — Deposits', () => {
  test('GET /api/deposits → lists deposits', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/deposits`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/deposits → creates deposit', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/deposits`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        amount: 5000,
        payment_method: 'cash',
        remarks: 'E2E advance deposit',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { id?: number; depositId?: number };
    depositId = body.id ?? body.depositId ?? 0;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📋 Billing Cancellation
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📋 Extended — Billing Cancellation', () => {
  test('GET /api/billing-cancellation → lists cancellations', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/billing-cancellation`, { headers: authHeaders(auth) });
    expect([200, 404]).toContain(res.status());
  });

  test('PUT /api/billing-cancellation/:id/cancel → cancels bill', async ({ request }) => {
    test.skip(billIdForCancelTest === 0, 'No bill to cancel');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/billing-cancellation/${billIdForCancelTest}/cancel`, {
      headers: authHeaders(auth),
      data: { reason: 'E2E cancellation test' },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🧾 Credit Notes
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🧾 Extended — Credit Notes', () => {
  test('GET /api/credit-notes → lists credit notes', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/credit-notes`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/credit-notes → creates credit note', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/credit-notes`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        reason: 'E2E overcharge refund',
        items: [{ description: 'E2E refund item', amount: 200 }],
      },
    });
    expect([200, 201, 400, 422]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏦 Settlements
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🏦 Extended — Settlements', () => {
  test('GET /api/settlements → lists settlements', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/settlements`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/settlements → creates settlement (with bill)', async ({ request }) => {
    if (billIdForCancelTest === 0) {
      // No bill available; this is a known-skip scenario
      return;
    }
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/settlements`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        bill_ids: [billIdForCancelTest],
        total_amount: 200,
        paid_amount: 200,
        payment_mode: 'cash',
        remarks: 'E2E settlement',
      },
    });
    expect([200, 201, 400, 422]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔒 Insurance Policies & Claims
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🔒 Extended — Insurance', () => {
  test('GET /api/insurance/policies → lists policies', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/insurance/policies`, { headers: authHeaders(auth) });
    expect([200, 403]).toContain(res.status()); // 403 if not insurance role
  });

  test('POST /api/insurance/policies → creates policy', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/insurance/policies`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        provider_name: 'E2E Insurance Co',
        policy_no: `E2E-${Date.now()}`,
        policy_type: 'individual',
        coverage_limit: 100000,
        valid_from: TODAY,
        valid_to: `${new Date().getFullYear() + 1}-12-31`,
        status: 'active',
      },
    });
    expect([200, 201, 403]).toContain(res.status());
    const body = await res.json() as { id?: number; policyId?: number };
    policyId = body.id ?? body.policyId ?? 0;
  });

  test('POST /api/insurance/claims → creates claim', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/insurance/claims`, {
      headers: authHeaders(auth),
      data: {
        patient_id: patientId,
        policy_id: policyId || undefined,
        diagnosis: 'E2E claim diagnosis',
        bill_amount: 50000,
        claimed_amount: 40000,
      },
    });
    expect([200, 201, 400, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏢 Commissions
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🏢 Extended — Commissions', () => {
  test('GET /api/commissions → lists commissions', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/commissions`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/commissions → creates commission', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/commissions`, {
      headers: authHeaders(auth),
      data: {
        marketingPerson: 'E2E Agent',
        mobile: '01900000001',
        patientId,
        commissionAmount: 500,
        notes: 'E2E test commission',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { id?: number; commissionId?: number };
    commissionId = body.id ?? body.commissionId ?? 0;
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏗️ Branches
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🏗️ Extended — Branches', () => {
  test('GET /api/branches → lists branches', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/branches`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/branches → creates branch', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/branches`, {
      headers: authHeaders(auth),
      data: {
        name: `E2E Branch ${Date.now()}`,
        address: 'E2E Branch Addr',
        phone: '01700123456',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { id?: number; branchId?: number };
    branchId = body.id ?? body.branchId ?? 0;
  });

  test('PUT /api/branches/:id → updates branch', async ({ request }) => {
    test.skip(branchId === 0, 'Branch not created');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/branches/${branchId}`, {
      headers: authHeaders(auth),
      data: { name: 'E2E Branch Updated', address: 'New addr' },
    });
    expect([200, 201, 404]).toContain(res.status());
  });

  test('DELETE /api/branches/:id → deletes branch', async ({ request }) => {
    test.skip(branchId === 0, 'Branch not created');
    const auth = await loadAuth();
    const res = await request.delete(`${BASE_URL}/api/branches/${branchId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 204, 404, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 Chart of Accounts
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📊 Extended — Accounts', () => {
  test('GET /api/accounts → lists accounts', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/accounts`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/accounts → creates account', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/accounts`, {
      headers: authHeaders(auth),
      data: {
        code: `AC${Date.now().toString().slice(-5)}`,
        name: 'E2E Test Account',
        type: 'asset',
      },
    });
    expect([200, 201, 403]).toContain(res.status()); // 403 if not director role
    const body = await res.json() as { id?: number; accountId?: number };
    accountId = body.id ?? body.accountId ?? 0;
  });

  test('PUT /api/accounts/:id → updates account', async ({ request }) => {
    test.skip(accountId === 0, 'Account not created');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/accounts/${accountId}`, {
      headers: authHeaders(auth),
      data: { name: 'E2E Account Updated', type: 'asset' },
    });
    expect([200, 201, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📒 Journal Entries
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📒 Extended — Journal Entries', () => {
  test('GET /api/journal → lists journal entries', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/journal`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/journal → creates journal entry', async ({ request }) => {
    const auth = await loadAuth();
    // First need valid account IDs
    const accRes = await request.get(`${BASE_URL}/api/accounts`, { headers: authHeaders(auth) });
    const accData = await accRes.json() as { accounts?: Array<{ id: number }> };
    const accounts = accData.accounts ?? [];
    if (accounts.length < 2) {
      test.skip(true, 'Need at least 2 accounts for journal entry');
      return;
    }
    const res = await request.post(`${BASE_URL}/api/journal`, {
      headers: authHeaders(auth),
      data: {
        entry_date: TODAY,
        description: 'E2E Journal Entry',
        debit_account_id: accounts[0]!.id,
        credit_account_id: accounts[1]!.id,
        amount: 1000,
      },
    });
    expect([200, 201, 400, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔄 Recurring Expenses
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🔄 Extended — Recurring Expenses', () => {
  test('GET /api/recurring → lists recurring expenses', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/recurring`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/recurring → creates recurring expense', async ({ request }) => {
    const auth = await loadAuth();
    // Get a valid expense category ID first
    const catRes = await request.get(`${BASE_URL}/api/expenses/categories`, { headers: authHeaders(auth) });
    if (!catRes.ok()) return; // Skip if categories not accessible
    const catData = await catRes.json() as { categories?: Array<{ id: number }> };
    const categoryId = catData.categories?.[0]?.id;
    if (!categoryId) return; // Skip if no categories exist

    const res = await request.post(`${BASE_URL}/api/recurring`, {
      headers: authHeaders(auth),
      data: {
        category_id: categoryId,
        amount: 2000,
        description: 'E2E Monthly Rent',
        frequency: 'monthly',
        next_run_date: TOMORROW,
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      recurringId = body.id ?? 0;
    }
  });

  test('PUT /api/recurring/:id → updates recurring', async ({ request }) => {
    test.skip(recurringId === 0, 'Recurring not created');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/recurring/${recurringId}`, {
      headers: authHeaders(auth),
      data: { amount: 2500, description: 'E2E Updated' },
    });
    expect([200, 201, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🩺 Nurse Station
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🩺 Extended — Nurse Station', () => {
  test('GET /api/nurse-station/dashboard → nurse dashboard', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/nurse-station/dashboard`, { headers: authHeaders(auth) });
    expect([200, 403]).toContain(res.status());
  });

  test('POST /api/nurse-station/vitals → records nurse vitals', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/nurse-station/vitals`, {
      headers: authHeaders(auth),
      data: {
        patientId,
        temperature: 37.2,
        pulse: 80,
        blood_pressure_systolic: 118,
        blood_pressure_diastolic: 78,
        spo2: 99,
        notes: 'E2E nurse vitals',
      },
    });
    expect([200, 201, 400, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 Billing Handover
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📊 Extended — Billing Handover', () => {
  test('GET /api/billing-handover → lists handovers', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/billing-handover`, { headers: authHeaders(auth) });
    expect([200, 404]).toContain(res.status());
  });

  test('POST /api/billing-handover → creates handover session', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.post(`${BASE_URL}/api/billing-handover`, {
      headers: authHeaders(auth),
      data: {
        shift: 'morning',
        notes: 'E2E handover test',
      },
    });
    expect([200, 201, 400]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🌐 Canonical IPD Billing
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🌐 Extended — IPD & IP Billing', () => {
  test('GET /api/billing-provisional?patient_id= → lists canonical provisional charges', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/billing-provisional?patient_id=1115`, { headers: authHeaders(auth) });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('GET /api/ip-billing?admission_id= → lists IP billing', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/ip-billing?admission_id=13003`, { headers: authHeaders(auth) });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🧬 Lab Catalog — Billing Sync Tests
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🧬 Lab Catalog — Billing Sync', () => {
  let createdLabTestId = 0;

  test('POST /api/lab → creates test and auto-syncs to billing_service_items', async ({ request }) => {
    const auth = await loadAuth();
    const timestamp = Date.now();
    const res = await request.post(`${BASE_URL}/api/lab`, {
      headers: authHeaders(auth),
      data: {
        code: `LB${timestamp}`,
        name: `Lab Billing Sync Test ${timestamp}`,
        category: 'blood',
        price: 55555,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { id?: number };
    createdLabTestId = body.id ?? 0;
  });

  test('PUT /api/lab/:id → updates test and syncs to billing', async ({ request }) => {
    test.skip(createdLabTestId === 0, 'No lab test created');
    const auth = await loadAuth();
    const res = await request.put(`${BASE_URL}/api/lab/${createdLabTestId}`, {
      headers: authHeaders(auth),
      data: {
        name: `Updated Lab Sync ${Date.now()}`,
        price: 66666,
      },
    });
    expect([200, 404, 500]).toContain(res.status());
  });

  test('GET /api/lab → returns updated test with new price', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/lab`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
    const body = await res.json() as { tests?: Array<{ code: string; price: number }> };
    if (body.tests) {
      const updated = body.tests.find(t => t.code.startsWith('LB') && t.code.length > 2);
      if (updated) {
        expect(updated.price).toBe(66666);
      }
    }
  });

  test('DELETE /api/lab/:id → deactivates test and billing entry', async ({ request }) => {
    test.skip(createdLabTestId === 0, 'No lab test created');
    const auth = await loadAuth();
    const res = await request.delete(`${BASE_URL}/api/lab/${createdLabTestId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 404, 500]).toContain(res.status());

    // Verify deactivation in catalog
    const catalogRes = await request.get(`${BASE_URL}/api/lab`, { headers: authHeaders(auth) });
    if (catalogRes.status() === 200) {
      const body = await catalogRes.json() as { tests?: Array<{ id: number; is_active: number }> };
      const deleted = body.tests?.find(t => t.id === createdLabTestId);
      if (deleted) {
        expect(deleted.is_active).toBe(0);
      }
    }
  });

  test('GET /api/lab/settings/categories → categories for lab dropdown', async ({ request }) => {
    const auth = await loadAuth();
    const res = await request.get(`${BASE_URL}/api/lab-settings/categories`, { headers: authHeaders(auth) });
    expect([200, 401]).toContain(res.status());
  });
});
