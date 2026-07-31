/**
 * Discharge + Billing Integration E2E Workflow
 *
 * Tests the complete discharge flow:
 * 1. Patient creation + admission
 * 2. GET /api/billing/departments (new route)
 * 3. GET /api/admissions/:id (new route)
 * 4. GET /api/admissions/:id/billing-status (new route)
 * 5. Credit discharge (PUT /api/admissions/:id/credit-discharge)
 * 6. Normal discharge (PUT /api/admissions/:id with status=discharged)
 * 7. Verify bill_status_on_discharge tracking
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

let patient1Id = 0;
let patient2Id = 0;
let doctorId = 0;
let bed1Id = 0;
let bed2Id = 0;
let admission1Id = 0;
let admission2Id = 0;

const NOW = Date.now();
const PATIENT1_NAME = `Credit-Discharge-${NOW}`;
const PATIENT2_NAME = `Clean-Discharge-${NOW}`;

test.describe.serial('Discharge + Billing Integration', () => {
  test.beforeAll(() => {
    loadAuth();
  });

  // ─── Setup ─────────────────────────────────────────────────────────────

  test('seed patient 1', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
      data: {
        name: PATIENT1_NAME,
        fatherHusband: 'Test Father',
        address: '123 Discharge Rd',
        mobile: `017${String(NOW).slice(-8)}`,
        gender: 'male',
        age: 45,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    patient1Id = (body.patientId as number) ?? (body.id as number) ?? 0;
    expect(patient1Id).toBeGreaterThan(0);
  });

  test('seed patient 2', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
      data: {
        name: PATIENT2_NAME,
        fatherHusband: 'Test Father 2',
        address: '456 Clean Rd',
        mobile: `016${String(NOW).slice(-8)}`,
        gender: 'female',
        age: 35,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    patient2Id = (body.patientId as number) ?? (body.id as number) ?? 0;
    expect(patient2Id).toBeGreaterThan(0);
  });

  test('resolve doctor', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/doctors`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { doctors?: Array<{ id: number }> };
    doctorId = body.doctors?.[0]?.id ?? 1;
  });

  test('list available beds', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admissions/beds`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { beds?: Array<{ id: number; status: string }> };
    const available = (body.beds ?? []).filter(b => b.status === 'available');
    bed1Id = available[0]?.id ?? 0;
    bed2Id = available[1]?.id ?? 0;

    // Create beds if not enough available
    if (!bed1Id) {
      await request.post(`${BASE_URL}/api/admissions/beds`, {
        headers: authHeaders(),
        data: { ward_name: 'E2E Ward', bed_number: `E2E-A-${NOW}`, bed_type: 'general' },
      });
      // Re-fetch to get the created bed ID
      const res2 = await request.get(`${BASE_URL}/api/admissions/beds`, { headers: authHeaders() });
      const body2 = (await res2.json()) as { beds?: Array<{ id: number; status: string }> };
      const avail2 = (body2.beds ?? []).filter(b => b.status === 'available');
      bed1Id = avail2[0]?.id ?? 0;
      bed2Id = avail2[1]?.id ?? 0;
    }
    if (!bed2Id) {
      await request.post(`${BASE_URL}/api/admissions/beds`, {
        headers: authHeaders(),
        data: { ward_name: 'E2E Ward', bed_number: `E2E-B-${NOW}`, bed_type: 'general' },
      });
      const res2 = await request.get(`${BASE_URL}/api/admissions/beds`, { headers: authHeaders() });
      const body2 = (await res2.json()) as { beds?: Array<{ id: number; status: string }> };
      const avail2 = (body2.beds ?? []).filter(b => b.status === 'available');
      bed2Id = avail2.find(b => b.id !== bed1Id)?.id ?? avail2[0]?.id ?? 0;
    }
    expect(bed1Id).toBeGreaterThan(0);
    expect(bed2Id).toBeGreaterThan(0);
  });

  // ─── New Routes ────────────────────────────────────────────────────────

  test('GET /api/billing/departments returns 200', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/billing/departments`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { departments: unknown[] };
    expect(Array.isArray(body.departments)).toBe(true);
  });

  // ─── Admit Patients ────────────────────────────────────────────────────

  test('admit patient 1', async ({ request }) => {
    test.skip(!patient1Id || !bed1Id, 'Missing patient or bed');
    const res = await request.post(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(),
      data: {
        patient_id: patient1Id,
        bed_id: bed1Id,
        ...(doctorId ? { doctor_id: doctorId } : {}),
        admission_type: 'emergency',
        provisional_diagnosis: 'Credit discharge test',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    admission1Id = (body.admission_id as number) ?? (body.admissionId as number) ?? (body.id as number) ?? 0;
    expect(admission1Id).toBeGreaterThan(0);
  });

  test('admit patient 2', async ({ request }) => {
    test.skip(!patient2Id || !bed2Id, 'Missing patient or bed');
    const res = await request.post(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(),
      data: {
        patient_id: patient2Id,
        bed_id: bed2Id,
        ...(doctorId ? { doctor_id: doctorId } : {}),
        admission_type: 'planned',
        provisional_diagnosis: 'Clean discharge test',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    admission2Id = (body.admission_id as number) ?? (body.admissionId as number) ?? (body.id as number) ?? 0;
    expect(admission2Id).toBeGreaterThan(0);
  });

  // ─── GET /api/admissions/:id (new route) ───────────────────────────────

  test('GET /api/admissions/:id returns admission', async ({ request }) => {
    test.skip(!admission1Id, 'No admission');
    const res = await request.get(`${BASE_URL}/api/admissions/${admission1Id}`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { admission: Record<string, unknown> };
    expect(body.admission).toBeDefined();
    expect(body.admission.patient_name).toBeDefined();
  });

  test('GET /api/admissions/:id returns 404 for nonexistent', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admissions/999999`, { headers: authHeaders() });
    expect(res.status()).toBe(404);
  });

  // ─── Billing Status ────────────────────────────────────────────────────

  test('GET /api/admissions/:id/billing-status returns status', async ({ request }) => {
    test.skip(!admission1Id, 'No admission');
    const res = await request.get(`${BASE_URL}/api/admissions/${admission1Id}/billing-status`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bill_status_on_discharge).toBeDefined();
    expect(body.pending).toBeDefined();
    const pending = body.pending as Record<string, number>;
    expect(typeof pending.total).toBe('number');
    expect(typeof pending.provisional_amount).toBe('number');
    expect(typeof pending.pending_service_amount).toBe('number');
    expect(typeof pending.due_amount).toBe('number');
  });

  // ─── Credit Discharge ──────────────────────────────────────────────────

  test('PUT /api/admissions/:id/credit-discharge succeeds', async ({ request }) => {
    test.skip(!admission1Id, 'No admission');
    const res = await request.put(`${BASE_URL}/api/admissions/${admission1Id}/credit-discharge`, {
      headers: authHeaders(),
      data: {},
    });
    expect(res.status()).toBe(200);
  });

  test('verify admission 1 is discharged', async ({ request }) => {
    test.skip(!admission1Id, 'No admission');
    const res = await request.get(`${BASE_URL}/api/admissions/${admission1Id}`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { admission: Record<string, unknown> };
    expect(String(body.admission.status).toLowerCase()).toBe('discharged');
  });

  test('verify bill_status_on_discharge is credit', async ({ request }) => {
    test.skip(!admission1Id, 'No admission');
    const res = await request.get(`${BASE_URL}/api/admissions/${admission1Id}/billing-status`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bill_status_on_discharge).toBe('credit');
  });

  // ─── Normal Discharge (clean) ──────────────────────────────────────────

  test('PUT /api/admissions/:id normal discharge succeeds', async ({ request }) => {
    test.skip(!admission2Id, 'No admission');
    const res = await request.put(`${BASE_URL}/api/admissions/${admission2Id}`, {
      headers: authHeaders(),
      data: {
        status: 'discharged',
        discharge_condition_id: 1,
        discharge_type: 'Normal',
      },
    });
    expect(res.status()).toBe(200);
  });

  test('verify admission 2 is discharged', async ({ request }) => {
    test.skip(!admission2Id, 'No admission');
    const res = await request.get(`${BASE_URL}/api/admissions/${admission2Id}`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { admission: Record<string, unknown> };
    expect(String(body.admission.status).toLowerCase()).toBe('discharged');
  });

  test('verify bill_status_on_discharge is cleared', async ({ request }) => {
    test.skip(!admission2Id, 'No admission');
    const res = await request.get(`${BASE_URL}/api/admissions/${admission2Id}/billing-status`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.bill_status_on_discharge).toBe('cleared');
  });

  // ─── Credit Discharge on already discharged ────────────────────────────

  test('credit discharge fails on already discharged admission', async ({ request }) => {
    test.skip(!admission1Id, 'No admission');
    const res = await request.put(`${BASE_URL}/api/admissions/${admission1Id}/credit-discharge`, {
      headers: authHeaders(),
      data: {},
    });
    expect(res.status()).toBe(404);
  });

  // ─── Credit Discharge on nonexistent ───────────────────────────────────

  test('credit discharge returns 404 for nonexistent admission', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/admissions/999999/credit-discharge`, {
      headers: authHeaders(),
      data: {},
    });
    expect(res.status()).toBe(404);
  });
});
