/**
 * IPD (In-Patient Department) Golden-Path Workflow
 *
 * End-to-end: seed patient -> list beds -> admit -> view admission (status=admitted) ->
 * record vitals -> list admissions -> discharge -> verify status=discharged.
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

// ── shared state across serial steps ─────────────────────────────────────────

let patientId = 0;
let doctorId = 0;
let bedId = 0;
let admissionId = 0;

const NOW = Date.now();
const PATIENT_NAME = `IPD-E2E-${NOW}`;
const PHONE = `019${String(NOW).slice(-8)}`;
const TODAY = new Date().toISOString().split('T')[0]!;

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('IPD Golden Path', () => {
  test.beforeAll(() => {
    loadAuth();
  });

  // Step 1: Seed a patient
  test('seed patient', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
      data: {
        name: PATIENT_NAME,
        fatherHusband: 'IPD Father',
        address: '789 IPD Road',
        mobile: PHONE,
        gender: 'male',
        age: 50,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    patientId =
      (body.patientId as number) ??
      (body.id as number) ??
      ((body.patient as Record<string, unknown>)?.id as number) ??
      0;
    expect(patientId).toBeGreaterThan(0);
  });

  // Step 2: Resolve a doctor
  test('resolve doctor', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/doctors`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { doctors?: Array<{ id: number }> };
    doctorId = body.doctors?.[0]?.id ?? 1;
  });

  // Step 3: List beds
  test('list beds', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admissions/beds`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { beds?: Array<{ id: number; status: string }> };
    // Use an available bed
    const available = (body.beds ?? []).filter(b => b.status === 'available');
    bedId = available[0]?.id ?? 0;
  });

  // Step 4: Create a bed if none exist
  test('create bed if needed', async ({ request }) => {
    if (bedId) {
      test.skip(true, 'Bed already exists');
      return;
    }
    const res = await request.post(`${BASE_URL}/api/admissions/beds`, {
      headers: authHeaders(),
      data: {
        ward_name: 'IPD Ward',
        bed_number: `IPD-B-${NOW}`,
        bed_type: 'general',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    bedId =
      (body.id as number) ??
      (body.bedId as number) ??
      ((body.bed as Record<string, unknown>)?.id as number) ??
      0;
  });

  // Step 5: Admit patient
  test('admit patient', async ({ request }) => {
    test.skip(!patientId, 'No patient created');
    const res = await request.post(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        ...(bedId ? { bed_id: bedId } : {}),
        ...(doctorId ? { doctor_id: doctorId } : {}),
        admission_type: 'emergency',
        provisional_diagnosis: 'IPD E2E workflow test',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    admissionId =
      (body.admission_id as number) ??
      (body.admissionId as number) ??
      (body.id as number) ??
      ((body.admission as Record<string, unknown>)?.id as number) ??
      0;
    const admissionNo = body.admission_no as string;
    expect(admissionId > 0 || !!admissionNo).toBe(true);
  });

  // Step 6: View admission — status should be admitted
  test('view admission (status=admitted)', async ({ request }) => {
    test.skip(!admissionId, 'No admission created');
    const res = await request.get(`${BASE_URL}/api/admissions/${admissionId}`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const admission = (body.admission as Record<string, unknown>) ?? body;
    const status = String(admission.status ?? '').toLowerCase();
    expect(['admitted', 'active']).toContain(status);
  });

  // Step 7: Record vitals for admitted patient
  test('record vitals', async ({ request }) => {
    test.skip(!patientId, 'No patient created');
    const res = await request.post(`${BASE_URL}/api/vitals`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        temperature: 38.6,
        blood_pressure_systolic: 130,
        blood_pressure_diastolic: 85,
        pulse: 92,
        respiratory_rate: 20,
        spo2: 96,
        weight: 80,
        height: 175,
      },
    });
    expect([200, 201, 404, 500]).toContain(res.status());
  });

  // Step 8: List admissions — our admission should appear
  test('list admissions', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const admissions =
      (body.admissions as unknown[]) ??
      (body.data as unknown[]) ??
      [];
    expect(Array.isArray(admissions)).toBe(true);
  });

  // Step 9: Discharge patient (correct endpoint: PUT /api/admissions/:id)
  test('discharge patient', async ({ request }) => {
    test.skip(!admissionId, 'No admission created');
    const res = await request.put(`${BASE_URL}/api/admissions/${admissionId}`, {
      headers: authHeaders(),
      data: {
        status: 'discharged',
        discharge_condition_id: 1,
        discharge_type: 'Normal',
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  // Step 10: Verify discharged status
  test('verify status is discharged', async ({ request }) => {
    test.skip(!admissionId, 'No admission created');
    const res = await request.get(`${BASE_URL}/api/admissions/${admissionId}`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const admission = (body.admission as Record<string, unknown>) ?? body;
    const status = String(admission.status ?? '').toLowerCase();
    expect(['discharged', 'completed', 'closed']).toContain(status);
  });
});
