/**
 * Ozzyl HMS — Integration Tests: Nursing API Endpoints
 *
 * Tests all nursing module routes with:
 *  - Auth contract (401 without auth)
 *  - Tenant isolation
 *  - RBAC (nurse vs reception vs accountant)
 *  - CRUD operations with validation
 *  - Response shape contracts
 *
 * Run:
 *   E2E_EMAIL=admin@demo-hospital.com E2E_PASSWORD=Demo@1234 npx playwright test --project=nursing-api
 */

import { test, expect } from '@playwright/test';
import { BASE_URL, loadAuth, authHeaders } from '../helpers/auth-helper';

const SLA_MS = 5000;

test.beforeAll(async () => {
  const auth = loadAuth();
  console.log(`✅ Auth loaded: ${auth.user.name} (${auth.user.role})`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTH CONTRACT — All nursing endpoints require auth
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🔒 Nursing — Auth Contract (401 without auth)', () => {
  const NURSING_GET_ENDPOINTS = [
    '/api/nursing/patients',
    '/api/nursing/wards',
    '/api/nursing/wards/bed-grid',
    '/api/nursing/care-plan',
    '/api/nursing/notes',
    '/api/nursing/mar',
    '/api/nursing/io',
    '/api/nursing/monitoring',
    '/api/nursing/iv-drugs',
    '/api/nursing/wound-care',
    '/api/nursing/handover',
    '/api/nursing/medication-orders',
    '/api/nursing/medication-reconciliation',
    '/api/nursing/medication-due',
    '/api/nursing/diet-sheet',
    '/api/nursing/activity-log?patient_id=1',
    '/api/nursing/respiratory?patient_id=1',
    '/api/nursing/opd/visits',
  ];

  for (const endpoint of NURSING_GET_ENDPOINTS) {
    test(`GET ${endpoint} → 401 without auth`, async ({ request }) => {
      const res = await request.get(`${BASE_URL}${endpoint}`);
      expect(res.status()).not.toBe(500);
      expect([401, 403]).toContain(res.status());
    });
  }

  const NURSING_POST_ENDPOINTS: Array<[string, Record<string, unknown>]> = [
    ['/api/nursing/care-plan', { patient_id: 1, visit_id: 1 }],
    ['/api/nursing/notes', { patient_id: 1, visit_id: 1, note_type: 'general', note: 'test' }],
    ['/api/nursing/io', { patient_id: 1, visit_id: 1 }],
    ['/api/nursing/monitoring', { patient_id: 1, visit_id: 1, temperature: 98.6 }],
    ['/api/nursing/iv-drugs', { patient_id: 1, visit_id: 1, drug_name: 'NS' }],
    ['/api/nursing/wound-care', { patient_id: 1, visit_id: 1 }],
    ['/api/nursing/handover', { patient_id: 1, visit_id: 1, shift: 'morning', given_by: 1, taken_by: 2, content: 'test' }],
    ['/api/nursing/medication-orders', { patient_id: 1, visit_id: 1, medication_name: 'Paracetamol', dose: '500mg', frequency: 'TDS' }],
    ['/api/nursing/respiratory', { patient_id: 1, entry_type: 'oxygen' }],
    ['/api/nursing/final-diagnosis', { visit_id: 1, patient_id: 1, final_diagnosis: 'Test' }],
  ];

  for (const [endpoint, body] of NURSING_POST_ENDPOINTS) {
    test(`POST ${endpoint} → 401 without auth`, async ({ request }) => {
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: { 'Content-Type': 'application/json' },
      });
      expect(res.status()).not.toBe(500);
      expect([401, 403]).toContain(res.status());
    });
  }

  test('PUT /api/nursing/medication-orders/1/status → 401 without auth', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/nursing/medication-orders/1/status`, {
      data: { status: 'acknowledged' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/nursing/wards/bed-grid — Bed grid with vitals, alerts, med-due
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🛏️ Nursing — Wards & Bed Grid', () => {
  test('GET /api/nursing/wards → returns ward list', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/nursing/wards`, {
      headers: authHeaders(),
    });
    const latency = Date.now() - start;

    expect(res.status()).toBeLessThan(500);
    expect(latency).toBeLessThan(SLA_MS);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('wards');
      expect(body).toHaveProperty('Results');
      expect(Array.isArray(body.wards)).toBe(true);
    }
  });

  test('GET /api/nursing/wards/bed-grid → returns enriched bed data', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/nursing/wards/bed-grid`, {
      headers: authHeaders(),
    });
    const latency = Date.now() - start;

    expect(res.status()).toBeLessThan(500);
    expect(latency).toBeLessThan(SLA_MS);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('beds');
      expect(Array.isArray(body.beds)).toBe(true);

      if (body.beds.length > 0) {
        const bed = body.beds[0];
        expect(bed).toHaveProperty('bed_id');
        expect(bed).toHaveProperty('ward_name');
        expect(bed).toHaveProperty('bed_number');
        expect(bed).toHaveProperty('bed_status');
        expect(bed).toHaveProperty('statusColor');

        if (bed.patient_id) {
          expect(bed).toHaveProperty('latestVitals');
          expect(bed).toHaveProperty('activeAlerts');
          expect(bed).toHaveProperty('medDueCount');
        }
      }
    }
  });

  test('GET /api/nursing/wards/bed-grid → response under SLA', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/nursing/wards/bed-grid`, {
      headers: authHeaders(),
    });
    const latency = Date.now() - start;

    expect(res.status()).toBeLessThan(500);
    expect(latency).toBeLessThan(SLA_MS);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/nursing/medication-orders — Medication order list
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('💊 Nursing — Medication Orders', () => {
  test('GET /api/nursing/medication-orders → returns paginated list', async ({ request }) => {
    const start = Date.now();
    const res = await request.get(`${BASE_URL}/api/nursing/medication-orders`, {
      headers: authHeaders(),
    });
    const latency = Date.now() - start;

    expect(res.status()).toBeLessThan(500);
    expect(latency).toBeLessThan(SLA_MS);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.Results)).toBe(true);
      expect(body.pagination).toHaveProperty('page');
      expect(body.pagination).toHaveProperty('limit');
      expect(body.pagination).toHaveProperty('total');
    }
  });

  test('GET /api/nursing/medication-orders?status=active → filters by status', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/medication-orders?status=active`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      for (const order of body.Results) {
        expect(order.status).toBe('active');
      }
    }
  });

  test('GET /api/nursing/medication-orders/:id → returns single order', async ({ request }) => {
    const listRes = await request.get(`${BASE_URL}/api/nursing/medication-orders?limit=1`, {
      headers: authHeaders(),
    });
    if (listRes.status() !== 200) return;

    const list = await listRes.json();
    if (!list.Results?.length) return;

    const orderId = list.Results[0].id;
    const res = await request.get(`${BASE_URL}/api/nursing/medication-orders/${orderId}`, {
      headers: authHeaders(),
    });

    expect(res.status()).toBeLessThan(500);
    if (res.status() === 200) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id', orderId);
      expect(body.Results).toHaveProperty('administrations');
      expect(Array.isArray(body.Results.administrations)).toBe(true);
    }
  });

  test('GET /api/nursing/medication-orders/999999 → 404 for nonexistent', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/medication-orders/999999`, {
      headers: authHeaders(),
    });
    expect([404, 401]).toContain(res.status());
  });

  test('GET /api/nursing/medication-orders/invalid → 400 for bad ID', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/medication-orders/abc`, {
      headers: authHeaders(),
    });
    expect([400, 401]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PUT /api/nursing/medication-orders/:id/status — Status transitions
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('💊 Nursing — Medication Order Status Updates', () => {
  const VALID_STATUSES = [
    'active', 'completed', 'discontinued', 'on_hold', 'cancelled',
  ];

  for (const status of VALID_STATUSES) {
    test(`PUT status → accepts valid status "${status}" without server error`, async ({ request }) => {
      const requiresReason = ['discontinued', 'on_hold', 'cancelled'].includes(status);
      const res = await request.put(`${BASE_URL}/api/nursing/medication-orders/1/status`, {
        data: { status, ...(requiresReason ? { status_reason: 'Clinical decision documented' } : {}) },
        headers: authHeaders(),
      });
      expect(res.status()).not.toBe(500);
      expect([200, 401, 404, 409]).toContain(res.status());
    });
  }

  test('PUT status → rejects invalid status', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/nursing/medication-orders/1/status`, {
      data: { status: 'totally_invalid' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('PUT status → requires a reason for on-hold decisions', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/nursing/medication-orders/1/status`, {
      data: { status: 'on_hold' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 404, 422]).toContain(res.status());
  });

  test('PUT status → 404 for nonexistent order', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/nursing/medication-orders/999999/status`, {
      data: { status: 'completed' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([404, 401]).toContain(res.status());
  });

  test('PUT status → 400 for bad ID', async ({ request }) => {
    const res = await request.put(`${BASE_URL}/api/nursing/medication-orders/abc/status`, {
      data: { status: 'completed' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. POST /api/nursing/notes — Create nursing note
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('📝 Nursing — Notes', () => {
  test('POST /api/nursing/notes → creates note with valid data', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/notes`, {
      data: {
        patient_id: 1,
        visit_id: 1,
        note_type: 'progress',
        note: 'E2E test note — patient stable',
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id');
      expect(typeof body.Results.id).toBe('number');
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/notes → validates required fields (empty body)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/notes`, {
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/nursing/notes → rejects missing note_type', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/notes`, {
      data: { patient_id: 1, visit_id: 1, note: 'test' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/nursing/notes → rejects empty note text', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/notes`, {
      data: { patient_id: 1, visit_id: 1, note_type: 'progress', note: '' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/nursing/notes — List notes for patient
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('📝 Nursing — Notes List', () => {
  test('GET /api/nursing/notes → returns paginated list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/notes`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.Results)).toBe(true);
    }
  });

  test('GET /api/nursing/notes?patient_id=1 → filters by patient', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/notes?patient_id=1`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      for (const note of body.Results) {
        expect(note.patient_id).toBe(1);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. POST /api/nursing/io — Intake/Output records
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('💧 Nursing — Intake/Output', () => {
  test('POST /api/nursing/io → creates I/O record', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/io`, {
      data: {
        patient_id: 1,
        visit_id: 1,
        intake_type: 'oral',
        intake_amount: 250,
        output_type: 'urine',
        output_amount: 200,
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id');
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/io → validates required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/io`, {
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('GET /api/nursing/io → returns paginated list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/io`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('pagination');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. POST /api/nursing/care-plan — Care plan items
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('📋 Nursing — Care Plan', () => {
  test('POST /api/nursing/care-plan → creates care plan item', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/care-plan`, {
      data: {
        patient_id: 1,
        visit_id: 1,
        problem: 'Acute pain',
        goal: 'Pain score < 3',
        intervention: 'Administer analgesics',
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id');
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/care-plan → validates required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/care-plan`, {
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('GET /api/nursing/care-plan → returns paginated list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/care-plan`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('pagination');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. POST /api/nursing/respiratory — Oxygen & Nebulization
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🫁 Nursing — Respiratory', () => {
  test('POST /api/nursing/respiratory → creates oxygen entry', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/respiratory`, {
      data: {
        patient_id: 1,
        entry_type: 'oxygen',
        delivery_mode: 'Nasal Cannula',
        flow_rate: 4,
        spo2_before: 88,
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id');
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/respiratory → creates nebulization entry', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/respiratory`, {
      data: {
        patient_id: 1,
        entry_type: 'nebulization',
        medicine_name: 'Salbutamol',
        dose: '2.5mg',
        response: 'improved',
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id');
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/respiratory → rejects invalid entry_type', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/respiratory`, {
      data: { patient_id: 1, entry_type: 'invalid_type' },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/nursing/respiratory → validates required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/respiratory`, {
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('GET /api/nursing/respiratory?patient_id=1 → returns respiratory records', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/respiratory?patient_id=1`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.Results)).toBe(true);
    }
  });

  test('GET /api/nursing/respiratory?entry_type=oxygen → filters by type', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/respiratory?patient_id=1&entry_type=oxygen`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      for (const record of body.Results) {
        expect(record.entry_type).toBe('oxygen');
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. GET /api/nursing/iv-drugs — IV fluid records
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('💉 Nursing — IV Drugs', () => {
  test('GET /api/nursing/iv-drugs → returns paginated list', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/iv-drugs`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body).toHaveProperty('pagination');
      expect(Array.isArray(body.Results)).toBe(true);
    }
  });

  test('POST /api/nursing/iv-drugs → creates IV drug entry', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/iv-drugs`, {
      data: {
        patient_id: 1,
        visit_id: 1,
        drug_name: 'Normal Saline 0.9%',
        dosing: '1000ml',
        rate: '125ml/hr',
        status: 'running',
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.Results).toHaveProperty('id');
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/iv-drugs → validates required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/iv-drugs`, {
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. GET /api/nursing/activity-log — Audit trail
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('📜 Nursing — Activity Log', () => {
  test('GET /api/nursing/activity-log → returns audit entries', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/activity-log?patient_id=1`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(Array.isArray(body.Results)).toBe(true);
    }
  });

  test('GET /api/nursing/activity-log → validates patient_id required', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/activity-log`, {
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('GET /api/nursing/activity-log?patient_id=1&limit=5 → respects limit', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/activity-log?patient_id=1&limit=5`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBeLessThan(500);

    if (res.status() === 200) {
      const body = await res.json();
      expect(body.Results.length).toBeLessThanOrEqual(5);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. POST /api/nursing/final-diagnosis — Final diagnosis
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🏥 Nursing — Final Diagnosis', () => {
  test('POST /api/nursing/final-diagnosis → creates with valid data', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/final-diagnosis`, {
      data: {
        visit_id: 1,
        patient_id: 1,
        final_diagnosis: 'Community-acquired pneumonia',
        icd10_code: 'J18.9',
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    if (res.status() === 201) {
      const body = await res.json();
      expect(body).toHaveProperty('Results', true);
    } else {
      expect([400, 401, 404]).toContain(res.status());
    }
  });

  test('POST /api/nursing/final-diagnosis → validates required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/final-diagnosis`, {
      data: {},
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/nursing/final-diagnosis → rejects diagnosis > 2000 chars', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/final-diagnosis`, {
      data: {
        visit_id: 1,
        patient_id: 1,
        final_diagnosis: 'x'.repeat(2001),
      },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Additional Nursing Modules — Smoke coverage
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🩺 Nursing — Additional Modules Smoke', () => {
  const GET_ENDPOINTS = [
    '/api/nursing/mar',
    '/api/nursing/monitoring',
    '/api/nursing/wound-care',
    '/api/nursing/handover',
    '/api/nursing/medication-reconciliation',
    '/api/nursing/medication-due',
    '/api/nursing/diet-sheet',
    '/api/nursing/clinical-summary',
    '/api/nursing/favourites',
    '/api/nursing/opd/visits',
  ];

  for (const endpoint of GET_ENDPOINTS) {
    test(`GET ${endpoint} → not 500`, async ({ request }) => {
      const start = Date.now();
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });
      const latency = Date.now() - start;

      expect(res.status(), `${endpoint} returned ${res.status()}`).toBeLessThan(500);
      expect(latency).toBeLessThan(SLA_MS);
    });
  }

  const POST_ENDPOINTS: Array<[string, Record<string, unknown>]> = [
    ['/api/nursing/monitoring', { patient_id: 1, visit_id: 1, temperature: 98.6, pulse: 72 }],
    ['/api/nursing/wound-care', { patient_id: 1, visit_id: 1, wound_site: 'left arm' }],
    ['/api/nursing/handover', { patient_id: 1, visit_id: 1, shift: 'night', given_by: 1, taken_by: 2, content: 'Stable' }],
  ];

  for (const [endpoint, body] of POST_ENDPOINTS) {
    test(`POST ${endpoint} → not 500 with valid body`, async ({ request }) => {
      const res = await request.post(`${BASE_URL}${endpoint}`, {
        data: body,
        headers: authHeaders(),
      });
      expect(res.status()).not.toBe(500);
      expect([200, 201, 400, 401, 404]).toContain(res.status());
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. RBAC — Role-based access control
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🔐 Nursing — RBAC Tests', () => {
  test('nursing role can access GET /api/nursing/patients', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/nursing/patients`, {
      headers: authHeaders(),
    });
    // If the logged-in user is a nursing role, should get 200
    // If not, should get 403
    expect(res.status()).not.toBe(500);
    expect([200, 401, 403]).toContain(res.status());

    if (['nurse', 'doctor', 'md', 'hospital_admin'].includes(auth.user.role)) {
      expect(res.status()).toBe(200);
    }
  });

  test('nursing role can access GET /api/nursing/wards/bed-grid', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/nursing/wards/bed-grid`, {
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([200, 401, 403]).toContain(res.status());

    if (['nurse', 'doctor', 'md', 'hospital_admin'].includes(auth.user.role)) {
      expect(res.status()).toBe(200);
    }
  });

  test('reception role gets 403 on nursing GET endpoints', async ({ request }) => {
    const auth = loadAuth();
    // Reception is NOT in NURSING_ROLES — should get 403
    // This test validates the RBAC middleware is active
    if (auth.user.role === 'reception') {
      const nursingEndpoints = [
        '/api/nursing/patients',
        '/api/nursing/wards',
        '/api/nursing/wards/bed-grid',
        '/api/nursing/care-plan',
        '/api/nursing/notes',
        '/api/nursing/mar',
        '/api/nursing/monitoring',
        '/api/nursing/iv-drugs',
      ];

      for (const endpoint of nursingEndpoints) {
        const res = await request.get(`${BASE_URL}${endpoint}`, {
          headers: authHeaders(),
        });
        expect(res.status(), `${endpoint} should be 403 for reception`).toBe(403);
      }
    } else {
      test.skip();
    }
  });

  test('accountant role gets 403 on nursing GET endpoints', async ({ request }) => {
    const auth = loadAuth();
    // Accountant is NOT in NURSING_ROLES — should get 403
    if (auth.user.role === 'accountant') {
      const nursingEndpoints = [
        '/api/nursing/patients',
        '/api/nursing/wards/bed-grid',
        '/api/nursing/care-plan',
        '/api/nursing/notes',
      ];

      for (const endpoint of nursingEndpoints) {
        const res = await request.get(`${BASE_URL}${endpoint}`, {
          headers: authHeaders(),
        });
        expect(res.status(), `${endpoint} should be 403 for accountant`).toBe(403);
      }
    } else {
      test.skip();
    }
  });

  test('reception role can access OPD endpoints (in OPD_ROLES)', async ({ request }) => {
    const auth = loadAuth();
    if (auth.user.role === 'reception') {
      const res = await request.get(`${BASE_URL}/api/nursing/opd/visits`, {
        headers: authHeaders(),
      });
      // reception is in OPD_ROLES, so should be 200
      expect(res.status()).not.toBe(500);
      expect([200, 401]).toContain(res.status());
    } else {
      test.skip();
    }
  });

  test('medication-orders POST restricted to doctor/md/admin (CPOE)', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/nursing/medication-orders`, {
      data: {
        patient_id: 1,
        visit_id: 1,
        medication_name: 'Test',
        dose: '500mg',
        frequency: 'TDS',
      },
      headers: authHeaders(),
    });

    expect(res.status()).not.toBe(500);
    // doctor/md/hospital_admin → 200 or 201
    // nurse → 403 (not in CPOE roles)
    if (auth.user.role === 'nurse') {
      expect(res.status()).toBe(403);
    } else if (['doctor', 'md', 'hospital_admin'].includes(auth.user.role)) {
      expect([200, 201, 400, 404]).toContain(res.status());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. Tenant Isolation — Data scoped to tenant
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🏢 Nursing — Tenant Isolation', () => {
  test('all nursing endpoints require X-Tenant-Slug header', async ({ request }) => {
    const auth = loadAuth();
    const endpoints = [
      '/api/nursing/patients',
      '/api/nursing/wards',
      '/api/nursing/notes',
      '/api/nursing/care-plan',
      '/api/nursing/medication-orders',
    ];

    for (const endpoint of endpoints) {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
          // Deliberately omit X-Tenant-Slug
        },
      });
      expect(res.status()).not.toBe(500);
      // Should be 401/403 without tenant context
      expect([401, 403]).toContain(res.status());
    }
  });

  test('invalid tenant slug → 401/403', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/nursing/patients`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`,
        'X-Tenant-Slug': 'nonexistent-hospital-slug',
      },
    });
    expect(res.status()).not.toBe(500);
    expect([401, 403, 404]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. Edge Cases — Invalid data, boundary conditions
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('🎯 Nursing — Edge Cases', () => {
  test('GET /api/nursing/medication-orders with invalid status → 400/422', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/medication-orders?status=bad_status`, {
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('GET /api/nursing/notes with invalid page → not 500', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/nursing/notes?page=-1&limit=0`, {
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
  });

  test('POST /api/nursing/io with negative amounts → not 500', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/io`, {
      data: { patient_id: 1, visit_id: 1, intake_amount: -100 },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('POST /api/nursing/respiratory with invalid flow_rate → not 500', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/respiratory`, {
      data: { patient_id: 1, entry_type: 'oxygen', flow_rate: 100 },
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
    expect([400, 401, 422]).toContain(res.status());
  });

  test('SQL injection in query param → not 500', async ({ request }) => {
    const malicious = encodeURIComponent("'; DROP TABLE nur_notes;--");
    const res = await request.get(`${BASE_URL}/api/nursing/notes?patient_id=${malicious}`, {
      headers: authHeaders(),
    });
    expect(res.status()).not.toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. Concurrent Load — No 5xx under parallel requests
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('⚡ Nursing — Concurrent Load', () => {
  test('10 concurrent GETs to nursing endpoints → all < 500', async ({ request }) => {
    const endpoints = [
      '/api/nursing/patients',
      '/api/nursing/wards',
      '/api/nursing/wards/bed-grid',
      '/api/nursing/care-plan',
      '/api/nursing/notes',
      '/api/nursing/mar',
      '/api/nursing/monitoring',
      '/api/nursing/iv-drugs',
      '/api/nursing/medication-orders',
      '/api/nursing/io',
    ];

    const start = Date.now();
    const responses = await Promise.all(
      endpoints.map(ep => request.get(`${BASE_URL}${ep}`, { headers: authHeaders() }))
    );
    const totalMs = Date.now() - start;

    for (const [i, res] of responses.entries()) {
      expect(res.status(), `${endpoints[i]} returned ${res.status()}`).toBeLessThan(500);
    }
    expect(totalMs).toBeLessThan(15_000);
  });

  test('5 concurrent POSTs to nursing endpoints → all < 500', async ({ request }) => {
    const posts = [
      request.post(`${BASE_URL}/api/nursing/notes`, {
        data: { patient_id: 1, visit_id: 1, note_type: 'test', note: 'concurrent test' },
        headers: authHeaders(),
      }),
      request.post(`${BASE_URL}/api/nursing/io`, {
        data: { patient_id: 1, visit_id: 1, intake_type: 'oral', intake_amount: 100 },
        headers: authHeaders(),
      }),
      request.post(`${BASE_URL}/api/nursing/care-plan`, {
        data: { patient_id: 1, visit_id: 1, problem: 'test' },
        headers: authHeaders(),
      }),
      request.post(`${BASE_URL}/api/nursing/iv-drugs`, {
        data: { patient_id: 1, visit_id: 1, drug_name: 'NS', dosing: '500ml' },
        headers: authHeaders(),
      }),
      request.post(`${BASE_URL}/api/nursing/respiratory`, {
        data: { patient_id: 1, entry_type: 'oxygen', delivery_mode: 'Nasal Cannula', flow_rate: 2 },
        headers: authHeaders(),
      }),
    ];

    const responses = await Promise.all(posts);
    for (const res of responses) {
      expect(res.status()).not.toBe(500);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. Response Shape Contract
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('📋 Nursing — Response Shape Contract', () => {
  test('all nursing 401 responses have JSON content-type', async ({ request }) => {
    const endpoints = [
      '/api/nursing/patients',
      '/api/nursing/wards',
      '/api/nursing/care-plan',
      '/api/nursing/notes',
    ];

    for (const endpoint of endpoints) {
      const res = await request.get(`${BASE_URL}${endpoint}`);
      const ct = res.headers()['content-type'] ?? '';
      expect(ct, `${endpoint} missing JSON content-type`).toContain('application/json');
    }
  });

  test('all paginated endpoints return consistent shape', async ({ request }) => {
    const paginatedEndpoints = [
      '/api/nursing/notes',
      '/api/nursing/care-plan',
      '/api/nursing/io',
      '/api/nursing/monitoring',
      '/api/nursing/iv-drugs',
      '/api/nursing/medication-orders',
    ];

    for (const endpoint of paginatedEndpoints) {
      const res = await request.get(`${BASE_URL}${endpoint}`, {
        headers: authHeaders(),
      });

      if (res.status() === 200) {
        const body = await res.json();
        expect(body, `${endpoint} missing Results`).toHaveProperty('Results');
        expect(body, `${endpoint} missing pagination`).toHaveProperty('pagination');
        expect(Array.isArray(body.Results), `${endpoint} Results not array`).toBe(true);
        expect(body.pagination).toHaveProperty('page');
        expect(body.pagination).toHaveProperty('limit');
        expect(body.pagination).toHaveProperty('total');
      }
    }
  });

  test('POST responses return { Results: { id } } shape', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/nursing/care-plan`, {
      data: { patient_id: 1, visit_id: 1 },
      headers: authHeaders(),
    });

    if (res.status() === 201) {
      const body = await res.json();
      expect(body).toHaveProperty('Results');
      expect(body.Results).toHaveProperty('id');
    }
  });
});
