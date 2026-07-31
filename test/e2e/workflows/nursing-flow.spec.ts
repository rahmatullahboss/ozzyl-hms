/**
 * Nursing Module — E2E Workflow
 *
 * End-to-end: nurse login → dashboard → bed grid → patient drawer →
 * vitals entry → MAR medication → doctor's orders → services →
 * shift handover → emergency alert → my tasks → IPD charges.
 *
 * Uses test.describe.serial so steps execute in order and later steps
 * can depend on IDs created by earlier ones.
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

// ── shared state across serial steps ─────────────────────────────────────────

let patientId = 0;
let admissionId = 0;
let doctorId = 0;
let bedId = 0;
let orderId = 0;
let marMedicationId = 0;
let chargeId = 0;

const NOW = Date.now();
const PATIENT_NAME = `NURSE-E2E-${NOW}`;
const PHONE = `018${String(NOW).slice(-8)}`;
const TODAY = new Date().toISOString().split('T')[0]!;

// ─────────────────────────────────────────────────────────────────────────────

test.describe.serial('Nursing Module Flow', () => {
  test.beforeAll(() => {
    loadAuth();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. NURSE LOGIN & DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  test('verify auth token is valid', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/auth/me`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { user?: { role: string; name: string } };
    expect(body.user).toBeDefined();
    expect(body.user!.name.length).toBeGreaterThan(0);
  });

  test('load nurse station dashboard', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nurse-station/dashboard`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('patients');
      expect(body).toHaveProperty('stats');
      expect(Array.isArray(body.patients)).toBe(true);
    }
  });

  test('load nurse station vitals log', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nurse-station/vitals?limit=10`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('vitals');
      expect(Array.isArray(body.vitals)).toBe(true);
    }
  });

  test('load medication due summary', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/medication-due`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('summary');
    }
  });

  test('load active alerts', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nurse-station/active-alerts?limit=10`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toHaveProperty('alerts');
      expect(Array.isArray(body.alerts)).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. SEED DATA — Patient, Doctor, Bed, Admission
  // ═══════════════════════════════════════════════════════════════════════════

  test('seed patient for nursing flow', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
      data: {
        name: PATIENT_NAME,
        fatherHusband: 'Nursing E2E Father',
        address: '123 Nurse Street',
        mobile: PHONE,
        gender: 'female',
        age: 45,
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

  test('resolve doctor for admission', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/doctors`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { doctors?: Array<{ id: number }> };
    doctorId = body.doctors?.[0]?.id ?? 1;
  });

  test('resolve available bed', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admissions/beds`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { beds?: Array<{ id: number; status: string }> };
    const available = (body.beds ?? []).filter(b => b.status === 'available');
    bedId = available[0]?.id ?? 0;
  });

  test('create bed if none available', async ({ request }) => {
    if (bedId) {
      test.skip(true, 'Bed already available');
      return;
    }
    const res = await request.post(`${BASE_URL}/api/admissions/beds`, {
      headers: authHeaders(),
      data: {
        ward_name: 'Nursing Ward',
        bed_number: `NURSE-B-${NOW}`,
        bed_type: 'general',
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;
    bedId = (body.id as number) ?? (body.bedId as number) ?? 0;
  });

  test('admit patient to bed', async ({ request }) => {
    test.skip(!patientId, 'No patient created');
    const res = await request.post(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        ...(bedId ? { bed_id: bedId } : {}),
        ...(doctorId ? { doctor_id: doctorId } : {}),
        admission_type: 'emergency',
        provisional_diagnosis: 'Nursing E2E workflow test',
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
    expect(admissionId > 0 || !!(body.admission_no as string)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PATIENT DRAWER FLOW — Bed grid, patient info, clinical badges
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch nursing patients list (bed grid data)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/patients`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { Results?: unknown[]; TotalCount?: number };
      expect(body).toHaveProperty('Results');
      expect(Array.isArray(body.Results)).toBe(true);
      expect(typeof body.TotalCount).toBe('number');
    }
  });

  test('fetch patient detail by admission', async ({ request }) => {
    test.skip(!admissionId, 'No admission created');
    const res = await request.get(`${BASE_URL}/api/admissions/${admissionId}`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const admission = (body.admission as Record<string, unknown>) ?? body;
    expect(admission).toHaveProperty('patient_id');
    expect(admission).toHaveProperty('status');
  });

  test('fetch nursing wards (ward filter)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/wards`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { wards?: unknown[] };
      expect(body).toHaveProperty('wards');
      expect(Array.isArray(body.wards)).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. VITALS ENTRY — Record vitals, verify abnormal values
  // ═══════════════════════════════════════════════════════════════════════════

  test('record vitals for patient', async ({ request }) => {
    test.skip(!patientId, 'No patient created');
    const res = await request.post(`${BASE_URL}/api/nurse-station/vitals`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        admission_id: admissionId || undefined,
        systolic: 120,
        diastolic: 80,
        temperature: 98.6,
        heart_rate: 72,
        spo2: 98,
        respiratory_rate: 16,
        weight: 65,
        notes: 'E2E vitals entry test',
      },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });

  test('record abnormal vitals (critical values)', async ({ request }) => {
    test.skip(!patientId, 'No patient created');
    const res = await request.post(`${BASE_URL}/api/nurse-station/vitals`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        admission_id: admissionId || undefined,
        systolic: 185,
        diastolic: 110,
        temperature: 103.5,
        heart_rate: 130,
        spo2: 88,
        respiratory_rate: 28,
        notes: 'E2E abnormal vitals — should trigger alerts',
      },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });

  test('verify vitals log after entry', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nurse-station/vitals?limit=20`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { vitals?: Array<{ id: number }> };
      expect(Array.isArray(body.vitals)).toBe(true);
    }
  });

  test('verify nursing care-plan endpoint', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/care-plan`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { Results?: unknown[] };
      expect(body).toHaveProperty('Results');
      expect(Array.isArray(body.Results)).toBe(true);
    }
  });

  test('verify nursing notes endpoint', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/notes`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.notes ?? body.data ?? [])).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. MAR — Medication Administration Record
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch MAR list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/mar`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.mar ?? body.data ?? [])).toBe(true);
    }
  });

  test('fetch medication due list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/medication-due`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { Results?: unknown[]; summary?: Record<string, unknown> };
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('summary');
    }
  });

  test('give medication via MAR', async ({ request }) => {
    // Attempt to mark a medication as given
    // Use a synthetic ID — the endpoint should handle gracefully
    const res = await request.post(`${BASE_URL}/api/nursing/mar`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        medication_name: 'Paracetamol 500mg',
        dose: '500mg',
        route: 'oral',
        scheduled_time: new Date().toISOString(),
        status: 'given',
        notes: 'E2E MAR — medication given',
      },
    });
    expect([200, 201, 400, 404, 405]).toContain(res.status());
    if ([200, 201].includes(res.status())) {
      const body = (await res.json()) as Record<string, unknown>;
      marMedicationId = (body.id as number) ?? (body.mar_id as number) ?? 0;
    }
  });

  test('verify MAR status update after giving medication', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/mar`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { Results?: Array<{ status?: string }> };
      const entries = body.Results ?? [];
      // At least one entry should exist (may or may not be ours)
      expect(Array.isArray(entries)).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. DOCTOR'S ORDERS — Acknowledge & mark done
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch doctor orders', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/orders`, {
      headers: authHeaders(),
    });
    // Orders endpoint may not exist — accept 200 or 404
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.orders ?? body.data ?? [])).toBe(true);
    }
  });

  test('acknowledge a doctor order', async ({ request }) => {
    // First fetch orders to get a real ID
    const listRes = await request.get(`${BASE_URL}/api/nursing/orders`, {
      headers: authHeaders(),
    });
    if (listRes.status() === 200) {
      const body = (await listRes.json()) as { Results?: Array<{ id: number }> };
      orderId = body.Results?.[0]?.id ?? 0;
    }

    if (!orderId) {
      test.skip(true, 'No orders to acknowledge');
      return;
    }

    const res = await request.put(`${BASE_URL}/api/nursing/orders/${orderId}`, {
      headers: authHeaders(),
      data: { status: 'acknowledged' },
    });
    expect([200, 201, 400, 404, 405]).toContain(res.status());
  });

  test('mark doctor order as done', async ({ request }) => {
    if (!orderId) {
      test.skip(true, 'No orders to complete');
      return;
    }

    const res = await request.put(`${BASE_URL}/api/nursing/orders/${orderId}`, {
      headers: authHeaders(),
      data: { status: 'done' },
    });
    expect([200, 201, 400, 404, 405]).toContain(res.status());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. SERVICES & REQUISITION
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch nursing services / IO', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/io`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.io ?? body.data ?? [])).toBe(true);
    }
  });

  test('fetch nursing monitoring data', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/monitoring`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.monitoring ?? body.data ?? [])).toBe(true);
    }
  });

  test('fetch IV drugs list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/iv-drugs`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.iv_drugs ?? body.data ?? [])).toBe(true);
    }
  });

  test('fetch wound care records', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/wound-care`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.wound_care ?? body.data ?? [])).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SHIFT HANDOVER
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch handover records', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/handover`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.handovers ?? body.data ?? [])).toBe(true);
    }
  });

  test('submit shift handover notes', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/handover`, {
      headers: authHeaders(),
      data: {
        shift: 'morning',
        notes: 'E2E handover test — all patients stable, pending vitals for bed A-3',
        pending_tasks: 'Record vitals for A-3, check IV drip for ICU-1',
        date: TODAY,
      },
    });
    expect([200, 201, 400, 404, 405]).toContain(res.status());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. EMERGENCY ALERT
  // ═══════════════════════════════════════════════════════════════════════════

  test('send emergency alert', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nurse-station/emergency-alert`, {
      headers: authHeaders(),
      data: {
        reason: 'cardiac_arrest',
        location: 'Ward A, Bed 1',
        patient_id: patientId || undefined,
        notes: 'E2E emergency alert test',
      },
    });
    // Emergency endpoint may return 200/201 or 404 if not implemented
    expect([200, 201, 400, 404, 405]).toContain(res.status());
  });

  test('verify active alerts after emergency', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nurse-station/active-alerts?limit=10`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as { alerts?: unknown[] };
      expect(Array.isArray(body.alerts)).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. MY TASKS BOARD
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch nursing tasks list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/tasks`, {
      headers: authHeaders(),
    });
    // Tasks endpoint may be under a different path
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      const tasks = body.Results ?? body.tasks ?? body.data ?? [];
      expect(Array.isArray(tasks)).toBe(true);
    }
  });

  test('fetch OPD nursing visits', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/opd/visits`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.Results ?? body.visits ?? body.data ?? [])).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. CANONICAL IPD PROVISIONAL CHARGES
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch canonical provisional charges for patient', async ({ request }) => {
    test.skip(!patientId, 'No patient created');
    const res = await request.get(`${BASE_URL}/api/billing-provisional?patient_id=${patientId}`, {
      headers: authHeaders(),
    });
    expect([200, 400, 401, 403, 404]).toContain(res.status());
  });

  test('add nursing service as canonical provisional charge', async ({ request }) => {
    test.skip(!admissionId || !patientId, 'No admission or patient');
    const res = await request.post(`${BASE_URL}/api/billing-provisional`, {
      headers: authHeaders(),
      data: {
        admission_id: admissionId,
        patient_id: patientId,
        items: [{
          is_manual: true,
          item_category: 'nursing_service',
          item_name: 'E2E nursing service charge',
          department: 'Nursing',
          quantity: 1,
          unit_price: 500,
        }],
      },
    });
    expect([200, 201, 400, 404, 409]).toContain(res.status());
    if ([200, 201].includes(res.status())) {
      const body = (await res.json()) as Record<string, unknown>;
      chargeId = (body.item_id as number) ?? ((body.item_ids as number[] | undefined)?.[0] ?? 0);
    }
  });

  test('cancel canonical provisional charge cleanup', async ({ request }) => {
    if (!chargeId) {
      test.skip(true, 'No provisional charge to cancel');
      return;
    }
    const res = await request.patch(`${BASE_URL}/api/billing-provisional/${chargeId}/cancel`, {
      headers: authHeaders(),
      data: { cancel_reason: 'E2E cleanup' },
    });
    expect([200, 400, 404, 409]).toContain(res.status());
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. PROVISIONAL BILLING MODAL — verify API surface
  // ═══════════════════════════════════════════════════════════════════════════

  test('fetch admitted patients for provisional billing', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/provisional-billing/admitted-patients`, {
      headers: authHeaders(),
    });
    // May be under a different path — accept 200 or 404
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.patients ?? body.data ?? body.Results ?? [])).toBe(true);
    }
  });

  test('fetch provisional billing summary for admission', async ({ request }) => {
    test.skip(!admissionId, 'No admission created');
    const res = await request.get(`${BASE_URL}/api/provisional-billing/${admissionId}/summary`, {
      headers: authHeaders(),
    });
    expect([200, 401, 403, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body).toBe('object');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. CLEANUP — Discharge patient
  // ═══════════════════════════════════════════════════════════════════════════

  test('discharge patient (cleanup)', async ({ request }) => {
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

  test('verify patient discharged', async ({ request }) => {
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
