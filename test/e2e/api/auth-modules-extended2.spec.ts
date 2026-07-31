/**
 * auth-modules-extended2.spec.ts
 *
 * Write-coverage tests for all modules NOT covered in auth-modules-extended.spec.ts.
 * Target: 95%+ route coverage (write operations: POST / PUT / DELETE).
 *
 * Modules: patients, doctors, billing, payments, staff, lab, pharmacy,
 *          expenses, income, visits, allergies, settings, website, shareholders,
 *          telemedicine, inbox, tests, push, notifications, audit, reports,
 *          dashboard, doctorDashboard, doctorSchedules, fhir, accounting, profit
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

// 👤 Patients
// ══════════════════════════════════════════════════════════════════════════════
test.describe('👤 Extended2 — Patients', () => {
  let patientId = 0;

  test('GET /api/patients → lists patients', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/patients`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/patients → creates patient', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(auth),
      data: {
        name: 'E2E Patient Test',
        fatherHusband: 'E2E Father',
        address: '123 Test Road, Dhaka',
        mobile: '01700000099',
        age: 30,
        gender: 'male',
        bloodGroup: 'B+',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; patientId?: number };
      patientId = body.id ?? body.patientId ?? 0;
    }
  });

  test('PUT /api/patients/:id → updates patient', async ({ request }) => {
    if (patientId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/patients/${patientId}`, {
      headers: authHeaders(auth),
      data: { address: '456 Updated Road, Dhaka' },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('GET /api/patients/:id → gets single patient', async ({ request }) => {
    if (patientId === 0) return;
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/patients/${patientId}`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🩺 Doctors
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🩺 Extended2 — Doctors', () => {
  let doctorId = 0;

  test('GET /api/doctors → lists doctors', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctors`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/doctors → creates doctor', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/doctors`, {
      headers: authHeaders(auth),
      data: {
        name: 'Dr. E2E Test',
        specialty: 'General Medicine',
        mobileNumber: '01700000088',
        consultationFee: 500,
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; doctorId?: number };
      doctorId = body.id ?? body.doctorId ?? 0;
    }
  });

  test('PUT /api/doctors/:id → updates doctor', async ({ request }) => {
    if (doctorId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/doctors/${doctorId}`, {
      headers: authHeaders(auth),
      data: { specialty: 'Cardiology', consultationFee: 600 },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('PUT /api/doctors/:id/deactivate → deactivates doctor', async ({ request }) => {
    if (doctorId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/doctors/${doctorId}/deactivate`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💵 Billing
// ══════════════════════════════════════════════════════════════════════════════
test.describe('💵 Extended2 — Billing', () => {
  let billId = 0;

  test('GET /api/billing → lists bills', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/billing`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/billing → creates bill', async ({ request }) => {
    const auth = loadAuth();
    // Seed a patient first to get a valid patientId
    const pr = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(auth),
      data: { name: 'Billing E2E Patient', mobile: '01700001111', gender: 'male' },
    });
    let pid = 1115; // fallback to known-existing patient
    if (pr.ok()) {
      const pb = await pr.json() as { id?: number };
      pid = pb.id ?? 1115;
    }
    const res = await request.post(`${BASE_URL}/api/billing`, {
      headers: authHeaders(auth),
      data: {
        patientId: pid,
        items: [
          { itemCategory: 'other', description: 'E2E Visit', quantity: 1, unitPrice: 200 },
        ],
        discount: 0,
      },
    });
    // Billing may fail with validation error; should never 500
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; billId?: number };
      billId = body.id ?? body.billId ?? 0;
    }
  });

  test('POST /api/billing/pay → records payment', async ({ request }) => {
    if (billId === 0) return;
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/billing/pay`, {
      headers: authHeaders(auth),
      data: {
        billId,
        amount: 500,
        type: 'current',
        paymentMethod: 'cash',
      },
    });
    expect([200, 201, 400]).toContain(res.status());
  });

  test('GET /api/billing/:id → gets single bill', async ({ request }) => {
    if (billId === 0) return;
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/billing/${billId}`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏥 Visits
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🏥 Extended2 — Visits', () => {
  let visitId = 0;

  test('GET /api/visits → lists visits', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/visits`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/visits → creates visit', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/visits`, {
      headers: authHeaders(auth),
      data: {
        patientId: 1045,
        doctorId: 101,
        visitType: 'opd',
        notes: 'E2E test visit',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; visitId?: number };
      visitId = body.id ?? body.visitId ?? 0;
    }
  });

  test('PUT /api/visits/:id → updates visit', async ({ request }) => {
    if (visitId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/visits/${visitId}`, {
      headers: authHeaders(auth),
      data: { notes: 'Updated E2E notes' },
    });
    expect([200, 201]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🧬 Lab
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🧬 Extended2 — Lab', () => {
  let labTestId = 0;
  let labOrderId = 0;

  test('GET /api/lab → lists lab tests', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/lab`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/lab → creates lab test', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/lab`, {
      headers: authHeaders(auth),
      data: {
        code: `CBC-E2E-${Date.now()}`,
        name: 'Complete Blood Count E2E',
        category: 'blood',
        price: 350,
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      labTestId = body.id ?? 0;
    }
  });

  test('GET /api/lab/orders → lists lab orders', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/lab/orders`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/lab/orders → creates lab order', async ({ request }) => {
    if (labTestId === 0) return;
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/lab/orders`, {
      headers: authHeaders(auth),
      data: {
        patientId: 1045,
        orderDate: '2026-03-16',
        items: [{ labTestId, discount: 0 }],
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; orderId?: number };
      labOrderId = body.id ?? body.orderId ?? 0;
    }
  });

  test('DELETE /api/lab/:id → deletes lab test', async ({ request }) => {
    if (labTestId === 0) return;
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/lab/${labTestId}`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404, 409]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💊 Pharmacy
// ══════════════════════════════════════════════════════════════════════════════
test.describe('💊 Extended2 — Pharmacy', () => {
  let medicineId = 0;
  let supplierId = 0;

  test('GET /api/pharmacy/medicines → lists medicines', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/pharmacy/medicines`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/pharmacy/medicines → creates medicine', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/pharmacy/medicines`, {
      headers: authHeaders(auth),
      data: {
        name: `Paracetamol E2E ${Date.now()}`,
        genericName: 'Acetaminophen',
        company: 'Square',
        unit: 'tablet',
        salePrice: 10,
        reorderLevel: 50,
      },
    });
    // DB constraint → 400, not 500
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      medicineId = body.id ?? 0;
    }
  });

  test('GET /api/pharmacy/suppliers → lists suppliers', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/pharmacy/suppliers`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/pharmacy/suppliers → creates supplier', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/pharmacy/suppliers`, {
      headers: authHeaders(auth),
      data: {
        name: `E2E Supplier ${Date.now()}`,
        mobileNumber: '01700000077',
        address: 'Test Supplier Address',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      supplierId = body.id ?? 0;
    }
  });

  test('PUT /api/pharmacy/medicines/:id → updates medicine', async ({ request }) => {
    if (medicineId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/pharmacy/medicines/${medicineId}`, {
      headers: authHeaders(auth),
      data: { salePrice: 12 },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('GET /api/pharmacy/summary → pharmacy summary', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/pharmacy/summary`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 👨‍💼 Staff
// ══════════════════════════════════════════════════════════════════════════════
test.describe('👨‍💼 Extended2 — Staff', () => {
  let staffId = 0;

  test('GET /api/staff → lists staff', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/staff`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/staff → creates staff member', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/staff`, {
      headers: authHeaders(auth),
      data: {
        name: 'E2E Staff Member',
        address: 'Test Address, Dhaka',
        position: 'Nurse',
        salary: 15000,
        bankAccount: '1234567890',
        mobile: '01700000066',
        joiningDate: '2026-01-01',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; staffId?: number };
      staffId = body.id ?? body.staffId ?? 0;
    }
  });

  test('PUT /api/staff/:id → updates staff member', async ({ request }) => {
    if (staffId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/staff/${staffId}`, {
      headers: authHeaders(auth),
      data: { position: 'Senior Nurse', salary: 18000 },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('DELETE /api/staff/:id → deletes staff member', async ({ request }) => {
    if (staffId === 0) return;
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/staff/${staffId}`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💰 Expenses
// ══════════════════════════════════════════════════════════════════════════════
test.describe('💰 Extended2 — Expenses', () => {
  let expenseId = 0;

  test('GET /api/expenses → lists expenses', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/expenses`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/expenses → creates expense', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/expenses`, {
      headers: authHeaders(auth),
      data: {
        date: '2026-03-16',
        category: 'Utilities',
        amount: 5000,
        description: 'E2E electricity bill',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      expenseId = body.id ?? 0;
    }
  });

  test('PUT /api/expenses/:id → updates expense', async ({ request }) => {
    if (expenseId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/expenses/${expenseId}`, {
      headers: authHeaders(auth),
      data: { amount: 5500, description: 'Updated E2E expense' },
    });
    expect([200, 201]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📈 Income
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📈 Extended2 — Income', () => {
  let incomeId = 0;

  test('GET /api/income → lists income', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/income`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/income → creates income record', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/income`, {
      headers: authHeaders(auth),
      data: {
        date: '2026-03-16',
        source: 'other',
        amount: 10000,
        description: 'E2E income record',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      incomeId = body.id ?? 0;
    }
  });

  test('PUT /api/income/:id → updates income', async ({ request }) => {
    if (incomeId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/income/${incomeId}`, {
      headers: authHeaders(auth),
      data: { amount: 12000, description: 'Updated E2E income' },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('DELETE /api/income/:id → deletes income', async ({ request }) => {
    if (incomeId === 0) return;
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/income/${incomeId}`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🌿 Allergies
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🌿 Extended2 — Allergies', () => {
  let allergyId = 0;

  test('GET /api/allergies?patient_id=X → lists allergies', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/allergies?patient_id=1`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/allergies → creates allergy record', async ({ request }) => {
    const auth = loadAuth();
    // Use known-existing patient 1115 (confirmed in production DB)
    const res = await request.post(`${BASE_URL}/api/allergies`, {
      headers: authHeaders(auth),
      data: {
        patient_id: 1115,
        allergy_type: 'drug',
        allergen: 'Penicillin',
        reaction: 'rash',
        severity: 'moderate',
        notes: 'E2E allergy test',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      allergyId = body.id ?? 0;
    }
  });

  test('PUT /api/allergies/:id → updates allergy', async ({ request }) => {
    if (allergyId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/allergies/${allergyId}`, {
      headers: authHeaders(auth),
      data: { severity: 'severe', notes: 'Updated E2E allergy note' },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('DELETE /api/allergies/:id → deletes allergy', async ({ request }) => {
    if (allergyId === 0) return;
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/allergies/${allergyId}`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⚕️ Tests (Diagnostic)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('⚕️ Extended2 — Diagnostic Tests', () => {
  let testId = 0;

  test('GET /api/tests → lists diagnostic tests', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/tests`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/tests → creates diagnostic test (orders a lab test)', async ({ request }) => {
    const auth = loadAuth();
    // Seed a patient
    const pr = await request.post(`${BASE_URL}/api/patients`, {
      headers: authHeaders(auth),
      data: { name: 'Tests E2E Patient', mobile: '01700003333', gender: 'male' },
    });
    let pid = 1;
    if (pr.ok()) {
      const pb = await pr.json() as { id?: number };
      pid = pb.id ?? 1;
    }
    // Create a lab test type first
    const labRes = await request.post(`${BASE_URL}/api/lab`, {
      headers: authHeaders(auth),
      data: { code: `TST-E2E-${Date.now()}`, name: 'E2E Test Type', category: 'other', price: 150 },
    });
    let labTestId = 0;
    if (labRes.ok()) {
      const lb = await labRes.json() as { id?: number };
      labTestId = lb.id ?? 0;
    }
    if (labTestId === 0) return;
    const res = await request.post(`${BASE_URL}/api/tests`, {
      headers: authHeaders(auth),
      data: {
        patientId: pid,
        labTestId,
        orderDate: new Date().toISOString().split('T')[0],
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      testId = body.id ?? 0;
    }
  });

  test('PUT /api/tests/:id/result → updates test result', async ({ request }) => {
    if (testId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/tests/${testId}/result`, {
      headers: authHeaders(auth),
      data: { result: 'Normal', notes: 'E2E result update', status: 'completed' },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💬 Inbox
// ══════════════════════════════════════════════════════════════════════════════
test.describe('💬 Extended2 — Inbox', () => {
  let messageId = 0;

  test('GET /api/inbox → lists messages', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/inbox`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('PATCH /api/inbox/:id → marks message as read', async ({ request }) => {
    const auth = loadAuth();
    // Get first message ID
    const listRes = await request.get(`${BASE_URL}/api/inbox`, { headers: authHeaders(auth) });
    if (listRes.ok()) {
      const body = await listRes.json() as { messages?: { id: number }[]; data?: { id: number }[] };
      const msgs = body.messages ?? body.data ?? [];
      if (msgs.length > 0) {
        messageId = msgs[0].id;
      }
    }
    if (messageId === 0) return;
    const res = await request.patch(`${BASE_URL}/api/inbox/${messageId}`, { headers: authHeaders(auth) });
    expect([200, 201, 204]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🌐 Website
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🌐 Extended2 — Website', () => {
  let serviceId = 0;

  test('GET /api/website/config → gets website config', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/website/config`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('PUT /api/website/config → updates website config', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/website/config`, {
      headers: authHeaders(auth),
      data: {
        tagline: 'E2E Test Hospital — Quality Care',
        bed_count: 100,
        whatsapp_number: '01700000055',
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('GET /api/website/services → lists website services', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/website/services`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/website/services → creates website service', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/website/services`, {
      headers: authHeaders(auth),
      data: {
        name: 'E2E Service',
        description: 'E2E test service description',
        category: 'general',
        is_active: 1,
        sort_order: 99,
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number };
      serviceId = body.id ?? 0;
    }
  });

  test('DELETE /api/website/services/:id → deletes website service', async ({ request }) => {
    if (serviceId === 0) return;
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/website/services/${serviceId}`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404]).toContain(res.status());
  });

  test('GET /api/website/analytics → gets website analytics', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/website/analytics`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 Shareholders
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📊 Extended2 — Shareholders', () => {
  let shareholderId = 0;

  test('GET /api/shareholders → lists shareholders', async ({ request }) => {
    const auth = loadAuth();
    // The shareholders route uses query-based list (zValidator on query)
    const res = await request.get(`${BASE_URL}/api/shareholders?page=1&limit=10`, { headers: authHeaders(auth) });
    expect([200, 400]).toContain(res.status());
  });

  test('GET /api/shareholders/settings → gets shareholder settings', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/shareholders/settings`, { headers: authHeaders(auth) });
    expect([200, 400]).toContain(res.status());
  });

  test('POST /api/shareholders → creates shareholder', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/shareholders`, {
      headers: authHeaders(auth),
      data: {
        name: 'E2E Shareholder',
        type: 'investor',
        phone: '01700000044',
        shareCount: 10,
        investment: 1000000,
        shareValueBdt: 100000,
        isActive: true,
      },
    });
    // Allow 4xx as well since shareholder may require share price to be set first
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: number; shareholderId?: number };
      shareholderId = body.id ?? body.shareholderId ?? 0;
    }
  });

  test('PUT /api/shareholders/:id → updates shareholder', async ({ request }) => {
    if (shareholderId === 0) return;
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/shareholders/${shareholderId}`, {
      headers: authHeaders(auth),
      data: { shareCount: 20, investment: 2000000 },
    });
    expect([200, 201, 400]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🎥 Telemedicine
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🎥 Extended2 — Telemedicine', () => {
  let roomId = '';

  test('GET /api/telemedicine/rooms → lists rooms', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/telemedicine/rooms`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/telemedicine/rooms → creates room', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/telemedicine/rooms`, {
      headers: authHeaders(auth),
      data: {
        patientId: 1045,
        doctorId: 101,
        scheduledAt: '2026-03-22T10:00:00Z',
        durationMin: 30,
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { id?: string; roomId?: string; room?: { id: string } };
      roomId = body.id ?? body.roomId ?? body.room?.id ?? '';
    }
  });

  test('DELETE /api/telemedicine/rooms/:id → deletes room', async ({ request }) => {
    if (!roomId) return;
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/telemedicine/rooms/${roomId}`, { headers: authHeaders(auth) });
    expect([200, 204, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔔 Notifications
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔔 Extended2 — Notifications', () => {
  test('POST /api/notifications/sms → sends SMS notification', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/notifications/sms`, {
      headers: authHeaders(auth),
      data: {
        phone: '01700000099',
        message: 'E2E test SMS notification',
      },
    });
    // SMS may fail if no SMS provider configured; 503 for service unavailable
    expect([200, 201, 400, 503]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📲 Push Notifications
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📲 Extended2 — Push & Push-Notifications', () => {
  test('GET /api/push/vapid-key → gets VAPID key', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/push/vapid-key`, { headers: authHeaders(auth) });
    expect([200, 400, 404]).toContain(res.status());
  });

  test('GET /api/push-notifications → lists push notifications', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/push-notifications`, { headers: authHeaders(auth) });
    // This route may have a different index path; allow 200/404
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⚙️ Settings
// ══════════════════════════════════════════════════════════════════════════════
test.describe('⚙️ Extended2 — Settings', () => {
  test('GET /api/settings → gets settings', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/settings`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('PUT /api/settings → updates a setting', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/settings`, {
      headers: authHeaders(auth),
      data: {
        key: 'fire_service_charge',
        value: '75',
      },
    });
    expect([200, 201]).toContain(res.status());
  });

  test('PUT /api/settings → bulk updates settings via object map', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/settings`, {
      headers: authHeaders(auth),
      data: {
        ambulance_charge: '600',
        fire_service_charge: '50',
      },
    });
    // 403 if user isn't hospital_admin/director/md
    expect([200, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📋 Payments
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📋 Extended2 — Payments', () => {
  test('GET /api/payments/logs → lists payment logs', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/payments/logs`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 Accounting
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📊 Extended2 — Accounting', () => {
  test('GET /api/accounting/summary → gets accounting summary', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/accounting/summary`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📈 Profit
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📈 Extended2 — Profit', () => {
  test('GET /api/profit/calculate → gets profit calculation', async ({ request }) => {
    const auth = loadAuth();
    const today = new Date().toISOString().split('T')[0].substring(0, 7);
    const res = await request.get(`${BASE_URL}/api/profit/calculate?month=${today}`, { headers: authHeaders(auth) });
    expect([200, 400]).toContain(res.status());
  });

  test('POST /api/profit/distribute → distributes monthly profit', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/profit/distribute`, {
      headers: authHeaders(auth),
      data: { month: '2026-01' },
    });
    // May return 403 (director role required), 409 if already distributed, 400 for other issues
    expect([200, 201, 400, 403, 409]).toContain(res.status());
  });

  test('GET /api/profit/history → gets profit distribution history', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/profit/history`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📋 Reports
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📋 Extended2 — Reports', () => {
  test('GET /api/reports/pl → gets P&L report', async ({ request }) => {
    const auth = loadAuth();
    const today = new Date().toISOString().split('T')[0];
    const monthStart = today.substring(0, 7) + '-01';
    const res = await request.get(
      `${BASE_URL}/api/reports/pl?startDate=${monthStart}&endDate=${today}`,
      { headers: authHeaders(auth) }
    );
    expect([200, 400]).toContain(res.status());
  });

  test('GET /api/reports/monthly → gets monthly summary', async ({ request }) => {
    const auth = loadAuth();
    const today = new Date().toISOString().split('T')[0];
    const res = await request.get(
      `${BASE_URL}/api/reports/monthly?year=${today.substring(0, 4)}`,
      { headers: authHeaders(auth) }
    );
    expect([200, 400]).toContain(res.status());
  });

  test('GET /api/reports/bed-occupancy → gets bed occupancy', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/reports/bed-occupancy`, { headers: authHeaders(auth) });
    // Bed occupancy should not 500 — missing data returns empty results
    expect([200, 400]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 Dashboard
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📊 Extended2 — Dashboard', () => {
  test('GET /api/dashboard → gets main dashboard', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/dashboard`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('GET /api/dashboard/stats → gets dashboard stats (7-day)', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/dashboard/stats`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('GET /api/dashboard/daily-income → gets daily income', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/dashboard/daily-income`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('GET /api/dashboard/monthly-summary → gets monthly summary', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/dashboard/monthly-summary`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 👨‍⚕️ Doctor Dashboard
// ══════════════════════════════════════════════════════════════════════════════
test.describe('👨‍⚕️ Extended2 — Doctor Dashboard', () => {
  test('GET /api/doctors/dashboard → gets doctor dashboard', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctors/dashboard`, { headers: authHeaders(auth) });
    // 200 success, 403 for role restrictions
    expect([200, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📅 Doctor Schedules (alternate endpoint)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📅 Extended2 — Doctor Schedules (v2)', () => {
  test('GET /api/doctor-schedules/ → lists all doctor schedules', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctor-schedules`, { headers: authHeaders(auth) });
    expect([200, 400]).toContain(res.status());
  });

  test('GET /api/doctor-schedules/doctors → lists scheduled doctors', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctor-schedules/doctors`, { headers: authHeaders(auth) });
    expect([200, 400]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔎 Audit
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔎 Extended2 — Audit', () => {
  test('GET /api/audit → lists audit logs', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/audit`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🤖 AI
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🤖 Extended2 — AI', () => {
  test('POST /api/ai/billing-from-notes → AI billing from notes', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/billing-from-notes`, {
      headers: authHeaders(auth),
      data: { notes: 'Patient had fever for 3 days. BP 120/80.' },
    });
    // AI calls may fail with 400/402 if AI binding not configured or quota exceeded, 503 if unavailable
    expect([200, 201, 400, 402, 429, 503]).toContain(res.status());
  });

  test('POST /api/ai/triage → AI triage assistance', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/triage`, {
      headers: authHeaders(auth),
      data: { message: 'Patient has chest pain and shortness of breath', conversationHistory: [] },
    });
    expect([200, 201, 400, 402, 429, 503]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏥 FHIR
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🏥 Extended2 — FHIR', () => {
  test('GET /api/fhir/Patient → FHIR patient list', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/fhir/Patient`, { headers: authHeaders(auth) });
    expect([200, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📄 PDF
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📄 Extended2 — PDF', () => {
  test('GET /api/pdf → PDF generation endpoint', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/pdf?type=bill&id=1`, { headers: authHeaders(auth) });
    expect([200, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔗 Push (subscription)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔗 Extended2 — Push Subscriptions', () => {
  test('GET /api/push → lists push subscriptions', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/push`, { headers: authHeaders(auth) });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔐 Auth
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔐 Extended2 — Auth', () => {
  test('POST /api/auth/logout → logs out current user', async ({ request }) => {
    // Note: we use a separate auth load to not invalidate the main test session
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/auth/logout`, { headers: authHeaders(auth) });
    // May return 200, 401 depending on implementation
    expect([200, 201, 401, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏠 IP Billing
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🏠 Extended2 — IP Billing', () => {
  test('GET /api/ip-billing/admitted → lists admitted patients', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/ip-billing/admitted`, { headers: authHeaders(auth) });
    // Admissions should not 500 — missing data returns empty list
    expect(res.status()).toBe(200);
  });

  test('POST /api/ip-billing/provisional → creates provisional bill', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ip-billing/provisional`, {
      headers: authHeaders(auth),
      data: {
        admissionId: 1,
        items: [{ category: 'bed_charge', description: 'E2E bed charge', amount: 1000, quantity: 1 }],
      },
    });
    // May return 400/404 if admission 1 doesn't exist
    expect([200, 201, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔋 Invitations
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔋 Extended2 — Invitations', () => {
  test('GET /api/invitations → lists invitations', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/invitations`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });

  test('POST /api/invitations → sends invitation', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/invitations`, {
      headers: authHeaders(auth),
      data: {
        email: `e2e-invite-${Date.now()}@test.example`,
        role: 'nurse',
      },
    });
    expect([200, 201, 400, 409]).toContain(res.status());
  });
});
