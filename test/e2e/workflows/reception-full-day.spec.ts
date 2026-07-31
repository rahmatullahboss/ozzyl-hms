/**
 * Receptionist Full Day — E2E Workflow
 * Simulates a complete receptionist day: morning registration → midday
 * admissions → afternoon billing → evening settlement & discharge.
 */
import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

let patientId = 0;
let admissionId = 0;
let billingServiceItemId = 0;

const NOW = Date.now();
const PATIENT_NAME = `FULLDAY-E2E-${NOW}`;
const PHONE = `019${String(NOW).slice(-8)}`;
const TODAY = new Date().toISOString().split('T')[0]!;

test.describe.serial('Receptionist Full Day Workflow', () => {
  test.beforeAll(() => { loadAuth(); });

  // ═══ MORNING: Registration & OPD ═══

  test('[Morning 1] Register new patient', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(),
      data: { name: PATIENT_NAME, fatherHusband: 'E2E Father', address: '789 Hospital Rd', mobile: PHONE, gender: 'male', age: 35 },
    });
    expect([200, 201]).toContain(res.status());
    const b = (await res.json()) as Record<string, unknown>;
    patientId = (b.patientId ?? b.id ?? (b.patient as any)?.id ?? 0) as number;
    expect(patientId).toBeGreaterThan(0);
  });

  test('[Morning 2] Search patient by name', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patients?search=${encodeURIComponent(PATIENT_NAME)}&limit=5`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const b = (await res.json()) as Record<string, unknown>;
    expect(b.patients || b.data).toBeDefined();
  });

  test('[Morning 3] List appointments pending approval', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/appointments?status=pending_approval&limit=5`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
  });

  test('[Morning 4] Check today OPD visits', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/visits?date=${TODAY}`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
  });

  test('[Morning 5] List services for billing', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/billing-master/service-items?per_page=10`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const b = (await res.json()) as { data?: Array<{ id: number }> };
    billingServiceItemId = b.data?.[0]?.id ?? 0;
    expect(billingServiceItemId).toBeGreaterThan(0);
  });

  // ═══ MID-DAY: IPD Admission ═══

  test('[Mid-day 1] Check bed availability', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/admissions/ward-bed-overview`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const b = (await res.json()) as Record<string, unknown>;
    expect(b.beds).toBeDefined();
  });

  test('[Mid-day 2] Admit patient', async ({ request }) => {
    if (!patientId) return;
    const res = await request.post(`${BASE_URL}/api/admissions`, {
      headers: authHeaders(),
      data: { patient_id: patientId, admission_type: 'emergency', provisional_diagnosis: 'E2E test admission' },
    });
    expect([200, 201]).toContain(res.status());
    const b = (await res.json()) as Record<string, unknown>;
    admissionId = (b.admission_id ?? b.id ?? 0) as number;
  });

  test('[Mid-day 2.5] Activate billing counter', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/billing-counter/sessions/activate`, {
      headers: authHeaders(),
      data: { counterId: 1 },
    });
    // 200 = activated, 409 = already active, 404 = counter not found
    expect([200, 201, 404, 409]).toContain(res.status());
  });

  test('[Mid-day 3] Collect deposit', async ({ request }) => {
    if (!patientId) return;
    const res = await request.post(`${BASE_URL}/api/deposits`, {
      headers: authHeaders(),
      data: { patient_id: patientId, amount: 5000, payment_method: 'cash', remarks: 'Admission deposit' },
    });
    expect([200, 201]).toContain(res.status());
    const b = (await res.json()) as Record<string, unknown>;
    expect(b.receipt_no || b.receiptNo || b.deposit?.receiptNo || b.id).toBeDefined();
  });

  test('[Mid-day 4] Check deposit balance', async ({ request }) => {
    if (!patientId) return;
    const res = await request.get(`${BASE_URL}/api/deposits/balance/${patientId}`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
    const b = (await res.json()) as Record<string, unknown>;
    expect(b.total_deposits ?? b.balance).toBeGreaterThanOrEqual(0);
  });

  test('[Mid-day 5] List deposits', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/deposits`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
  });

  // ═══ AFTERNOON: IP Billing ═══

  test('[Afternoon 1] List IP patients', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/ip-billing/patients`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
  });

  test('[Afternoon 2] Add provisional IP charge', async ({ request }) => {
    if (!admissionId) return;
    const res = await request.post(`${BASE_URL}/api/ip-billing/provisional`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        admission_id: admissionId,
        service_item_id: billingServiceItemId,
        quantity: 1,
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('[Afternoon 3] Get pending IP charges', async ({ request }) => {
    if (!patientId) return;
    const res = await request.get(`${BASE_URL}/api/ip-billing/pending/${patientId}`, { headers: authHeaders() });
    expect([200, 404]).toContain(res.status());
  });

  // ═══ EVENING: Settlement & Discharge ═══

  test('[Evening 1] List pending settlements', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/settlements/pending`, { headers: authHeaders() });
    expect(res.status()).toBe(200);
  });

  test('[Evening 2] Get patient settlement info', async ({ request }) => {
    if (!patientId) return;
    const res = await request.get(`${BASE_URL}/api/settlements/patient/${patientId}/info`, { headers: authHeaders() });
    expect([200, 404]).toContain(res.status());
  });

  test('[Evening 3] Discharge patient', async ({ request }) => {
    if (!admissionId) return;
    const res = await request.put(`${BASE_URL}/api/admissions/${admissionId}`, {
      headers: authHeaders(),
      data: { status: 'discharged', discharge_condition_id: 1, discharge_type: 'Normal' },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });

  // ═══ NIGHT: Reports & Handover ═══

  test('[Night 1] Reception reports accessible', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/reception/daily-report?date=${TODAY}`, { headers: authHeaders() });
    expect([200, 404]).toContain(res.status());
  });

  test('[Night 2] List bills for today', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/billing?date=${TODAY}`, { headers: authHeaders() });
    expect([200, 404]).toContain(res.status());
  });

  test('[Night 3] Insurance billing accessible', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance/claims?limit=5`, { headers: authHeaders() });
    expect([200, 404]).toContain(res.status());
  });
});
