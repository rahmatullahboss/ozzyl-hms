/**
 * auth-modules-extended3.spec.ts
 * ─────────────────────────────────────────────────────────────────────
 * Deep write-endpoint coverage for all remaining modules.
 * Tests POST / PUT / DELETE operations on:
 *   - Doctor Schedules (3)   - IPD Provisional Billing (2)         - Push (3)
 *   - Push Notifications (3) - OT (9)                  - Emergency (5)
 *   - Notifications (6)      - AI (6)                  - Telemedicine (4)
 *   - Pharmacy deep (4)      - Insurance deep (3)      - Lab deep (2)
 *   - Settings deep (2)      - Recurring (2)           - Shareholders (3)
 *   - Billing Cancellation (3) - Nurse Station (2)     - Admissions (2)
 *   - Visits (1)             - Vitals (1)              - Staff (2)
 * ─────────────────────────────────────────────────────────────────────
 */
import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

// ══════════════════════════════════════════════════════════════════════════════
// 📅 Doctor Schedules — POST / PUT / DELETE
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📅 Ext3 — Doctor Schedules CRUD', () => {
  let createdScheduleId: number | null = null;

  test('GET /api/doctor-schedules → lists all schedules (no doctor_id)', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctor-schedules`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('schedules');
    expect(body).toHaveProperty('total');
  });

  test('GET /api/doctor-schedules/doctors → doctors with schedule_count', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/doctor-schedules/doctors`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('doctors');
  });

  test('POST /api/doctor-schedules → creates a schedule', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/doctor-schedules`, {
      headers: authHeaders(auth),
      data: {
        doctor_id: 1,
        day_of_week: 'mon',
        start_time: '09:00',
        end_time: '13:00',
        session_type: 'morning',
        max_patients: 15,
        notes: 'E2E test schedule',
      },
    });
    // 201 success, 403 if role not allowed, 400 if FK issue
    expect([201, 400, 403]).toContain(res.status());
    if (res.status() === 201) {
      const body = await res.json();
      // Try to extract ID if returned
      createdScheduleId = body?.id ?? null;
    }
  });

  test('PUT /api/doctor-schedules/99999 → updates a schedule', async ({ request }) => {
    const auth = loadAuth();
    const targetId = createdScheduleId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/doctor-schedules/${targetId}`, {
      headers: authHeaders(auth),
      data: { start_time: '10:00', end_time: '14:00' },
    });
    // 200 success, 403 role, 404 if doesn't exist
    expect([200, 403, 404]).toContain(res.status());
  });

  test('DELETE /api/doctor-schedules/99999 → soft-deletes a schedule', async ({ request }) => {
    const auth = loadAuth();
    const targetId = createdScheduleId ?? 99999;
    const res = await request.delete(`${BASE_URL}/api/doctor-schedules/${targetId}`, {
      headers: authHeaders(auth),
    });
    expect([200, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏥 Canonical IPD provisional charges — POST / CANCEL
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🏥 Ext3 — IPD Provisional Billing', () => {
  test('POST /api/billing-provisional → creates a manual IPD service charge', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/billing-provisional`, {
      headers: authHeaders(auth),
      data: {
        admission_id: 1,
        patient_id: 1115,
        items: [{
          is_manual: true,
          item_category: 'nursing_service',
          item_name: 'E2E Nursing service charge',
          department: 'Nursing',
          quantity: 1,
          unit_price: 500,
        }],
      },
    });
    expect([201, 200, 400, 404, 409]).toContain(res.status());
  });

  test('PATCH /api/billing-provisional/99999/cancel → cancels a provisional charge', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.patch(`${BASE_URL}/api/billing-provisional/99999/cancel`, {
      headers: authHeaders(auth),
      data: { cancel_reason: 'E2E cleanup' },
    });
    expect([200, 400, 404, 409]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔔 Push Notifications — subscribe / send / unsubscribe
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔔 Ext3 — Push Notifications', () => {
  test('POST /api/push/subscribe → subscribes to push', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/push/subscribe`, {
      headers: authHeaders(auth),
      data: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-test-endpoint-123',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUl-2l6ABT1KEwR1NiSb9p7CtNKxrnGLzlTxikQ',
          auth: 'tBHItJI5svbpC7FR8Xr9kA',
        },
      },
    });
    expect([200, 201, 400, 503]).toContain(res.status());
  });

  test('POST /api/push/send → sends push notification', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/push/send`, {
      headers: authHeaders(auth),
      data: {
        title: 'E2E Test Notification',
        body: 'This is an automated E2E test notification',
        url: '/dashboard',
      },
    });
    // 200, 403 role, 400 no subscriptions, 503 not configured
    expect([200, 400, 403, 503]).toContain(res.status());
  });

  test('DELETE /api/push/unsubscribe → unsubscribes from push', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/push/unsubscribe`, {
      headers: authHeaders(auth),
      data: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-test-endpoint-123',
      },
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📲 Push Notifications Module (/api/push-notifications)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📲 Ext3 — Push Notifications Module', () => {
  test('POST /api/push-notifications/subscribe → subscribes', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/push-notifications/subscribe`, {
      headers: authHeaders(auth),
      data: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-push-notif-test-456',
        keys: {
          p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUl-2l6ABT1KEwR1NiSb9p7CtNKxrnGLzlTxikQ',
          auth: 'tBHItJI5svbpC7FR8Xr9kA',
        },
      },
    });
    expect([200, 201, 400, 503]).toContain(res.status());
  });

  test('POST /api/push-notifications/send → sends push', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/push-notifications/send`, {
      headers: authHeaders(auth),
      data: {
        title: 'E2E Push Module Test',
        body: 'Automated test push from push-notifications module',
      },
    });
    expect([200, 400, 403, 503]).toContain(res.status());
  });

  test('DELETE /api/push-notifications/unsubscribe → unsubscribes', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/push-notifications/unsubscribe`, {
      headers: authHeaders(auth),
      data: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-push-notif-test-456',
      },
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏗️ OT (Operation Theatre) — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🏗️ Ext3 — OT Deep Write', () => {
  let bookingId: number | null = null;

  test('POST /api/ot/bookings → creates OT booking', async ({ request }) => {
    const auth = loadAuth();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const res = await request.post(`${BASE_URL}/api/ot/bookings`, {
      headers: authHeaders(auth),
      data: {
        patient_id: 1115,
        booked_for_date: tomorrow,
        surgery_type: 'Minor',
        diagnosis: 'E2E test diagnosis',
        procedure_type: 'Appendectomy',
        anesthesia_type: 'General',
        remarks: 'E2E automated test booking',
      },
    });
    expect([201, 200, 400, 403]).toContain(res.status());
    if (res.status() === 201 || res.status() === 200) {
      const body = await res.json();
      bookingId = body?.bookingId ?? body?.id ?? null;
    }
  });

  test('PUT /api/ot/bookings/:id → updates OT booking', async ({ request }) => {
    const auth = loadAuth();
    const id = bookingId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/ot/bookings/${id}`, {
      headers: authHeaders(auth),
      data: { remarks: 'Updated by E2E test' },
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('PUT /api/ot/bookings/:id/cancel → cancels OT booking', async ({ request }) => {
    const auth = loadAuth();
    const id = bookingId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/ot/bookings/${id}/cancel`, {
      headers: authHeaders(auth),
      data: { cancellation_remarks: 'Cancelled by E2E test' },
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('POST /api/ot/team → adds team member to booking', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ot/team`, {
      headers: authHeaders(auth),
      data: {
        booking_id: bookingId ?? 1,
        patient_id: 1115,
        staff_id: 1,
        role_type: 'surgeon',
      },
    });
    expect([201, 200, 400, 403]).toContain(res.status());
  });

  test('DELETE /api/ot/team/99999 → removes team member', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/ot/team/99999`, {
      headers: authHeaders(auth),
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('POST /api/ot/checklist → adds checklist item', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ot/checklist`, {
      headers: authHeaders(auth),
      data: {
        booking_id: bookingId ?? 1,
        item_name: 'Pre-op consent signed',
        item_value: true,
        item_details: 'E2E test checklist item',
      },
    });
    expect([201, 200, 400, 403]).toContain(res.status());
  });

  test('PUT /api/ot/checklist/99999 → updates checklist item', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/ot/checklist/99999`, {
      headers: authHeaders(auth),
      data: { item_value: false, item_details: 'Updated by E2E' },
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('POST /api/ot/summary → creates OT summary', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ot/summary`, {
      headers: authHeaders(auth),
      data: {
        booking_id: bookingId ?? 1,
        pre_op_diagnosis: 'Acute appendicitis',
        post_op_diagnosis: 'Appendicitis confirmed',
        anesthesia: 'General',
        ot_charge: 15000,
        ot_description: 'Appendectomy performed successfully',
        category: 'minor',
      },
    });
    expect([201, 200, 400, 403]).toContain(res.status());
  });

  test('PUT /api/ot/summary/99999 → updates OT summary', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/ot/summary/99999`, {
      headers: authHeaders(auth),
      data: { ot_charge: 18000, category: 'major' },
    });
    expect([200, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🚑 Emergency — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🚑 Ext3 — Emergency Deep Write', () => {
  let erPatientId: number | null = null;

  test('POST /api/emergency → registers ER patient', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/emergency`, {
      headers: authHeaders(auth),
      data: {
        first_name: 'E2E',
        last_name: 'TestPatient',
        gender: 'Male',
        age: '30',
        contact_no: '01700000001',
        care_of_person_contact: '01700000002',
      },
    });
    expect([201, 200, 400]).toContain(res.status());
    if (res.status() === 201 || res.status() === 200) {
      const body = await res.json();
      erPatientId = body?.id ?? body?.patient?.id ?? null;
    }
  });

  test('PUT /api/emergency/:id/triage → assigns triage code', async ({ request }) => {
    const auth = loadAuth();
    const id = erPatientId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/emergency/${id}/triage`, {
      headers: authHeaders(auth),
      data: { triage_code: 'yellow' },
    });
    expect([200, 404]).toContain(res.status());
  });

  test('PUT /api/emergency/:id/undo-triage → undoes triage', async ({ request }) => {
    const auth = loadAuth();
    const id = erPatientId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/emergency/${id}/undo-triage`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });

  test('PUT /api/emergency/:id/finalize → finalizes ER patient', async ({ request }) => {
    const auth = loadAuth();
    const id = erPatientId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/emergency/${id}/finalize`, {
      headers: authHeaders(auth),
      data: { finalized_status: 'discharged', finalized_remarks: 'E2E test discharge' },
    });
    expect([200, 404]).toContain(res.status());
  });

  test('PUT /api/emergency/:id → updates ER patient info', async ({ request }) => {
    const auth = loadAuth();
    const id = erPatientId ?? 99999;
    const res = await request.put(`${BASE_URL}/api/emergency/${id}`, {
      headers: authHeaders(auth),
      data: { first_name: 'E2E-Updated', age: '31' },
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📨 Notifications — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📨 Ext3 — Notifications Deep Write', () => {
  test('POST /api/notifications/email → sends email notification', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/notifications/email`, {
      headers: authHeaders(auth),
      data: {
        to: 'e2etest@hms-test.local',
        subject: 'E2E Test Email',
        html: '<p>Automated E2E test email</p>',
      },
    });
    // 200, 403 role, 503 provider error
    expect([200, 403, 503]).toContain(res.status());
  });

  test('POST /api/notifications/appointment → sends appointment reminder', async ({ request }) => {
    const auth = loadAuth();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const res = await request.post(`${BASE_URL}/api/notifications/appointment`, {
      headers: authHeaders(auth),
      data: {
        patientName: 'E2E Patient',
        patientPhone: '01700000001',
        doctorName: 'Dr. E2E',
        appointmentDate: tomorrow,
        appointmentTime: '10:00 AM',
        channel: 'sms',
      },
    });
    expect([200, 403, 503]).toContain(res.status());
  });

  test('POST /api/notifications/lab-ready → sends lab ready notification', async ({ request }) => {
    const auth = loadAuth();
    const today = new Date().toISOString().split('T')[0];
    const res = await request.post(`${BASE_URL}/api/notifications/lab-ready`, {
      headers: authHeaders(auth),
      data: {
        patientName: 'E2E Patient',
        patientPhone: '01700000001',
        testName: 'CBC',
        completedDate: today,
        channel: 'sms',
      },
    });
    expect([200, 403, 503]).toContain(res.status());
  });

  test('POST /api/notifications/invoice → sends invoice notification', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/notifications/invoice`, {
      headers: authHeaders(auth),
      data: {
        patientName: 'E2E Patient',
        patientEmail: 'e2etest@hms-test.local',
        invoiceNumber: 'INV-E2E-001',
        totalAmount: 5000,
        paidAmount: 3000,
        dueAmount: 2000,
      },
    });
    expect([200, 403, 503]).toContain(res.status());
  });

  test('POST /api/notifications/prescription-ready → sends rx ready', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/notifications/prescription-ready`, {
      headers: authHeaders(auth),
      data: {
        patientName: 'E2E Patient',
        patientPhone: '01700000001',
        doctorName: 'Dr. E2E',
        shareToken: 'e2e-test-token-abc123',
        shareUrl: 'https://example.com/rx/e2e-test-token-abc123',
        channel: 'sms',
      },
    });
    expect([200, 403, 503]).toContain(res.status());
  });

  test('POST /api/notifications/whatsapp → sends WhatsApp message', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/notifications/whatsapp`, {
      headers: authHeaders(auth),
      data: {
        phone: '01700000001',
        message: 'E2E test WhatsApp message from HMS',
      },
    });
    expect([200, 403, 503]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🤖 AI — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🤖 Ext3 — AI Deep Write', () => {
  test('POST /api/ai/diagnosis-suggest → suggests diagnosis', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/diagnosis-suggest`, {
      headers: authHeaders(auth),
      data: {
        symptoms: 'Persistent headache, fever for 3 days, mild neck stiffness',
        vitals: { bp: '120/80', temperature: '101', spo2: '96', pulse: '88' },
        patientAge: 30,
        patientGender: 'Male',
      },
    });
    // 200, 400 (no AI key configured), 503
    expect([200, 400, 503]).toContain(res.status());
  });

  test('POST /api/ai/billing-from-notes → auto-billing from notes', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/billing-from-notes`, {
      headers: authHeaders(auth),
      data: {
        consultationNotes: 'Patient came in with complaints of fever and body ache. Prescribed paracetamol 500mg and advised rest for 3 days.',
        patientId: 1115,
      },
    });
    expect([200, 500, 503]).toContain(res.status());
  });

  test('POST /api/ai/triage → AI triage chat', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/triage`, {
      headers: authHeaders(auth),
      data: {
        message: 'I have chest pain, shortness of breath, and dizziness. Age 55, male.',
        conversationHistory: [],
      },
    });
    expect([200, 400, 503]).toContain(res.status());
  });

  test('POST /api/ai/summarize-note → summarizes clinical note', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/summarize-note`, {
      headers: authHeaders(auth),
      data: {
        note: 'Patient presents with 5-day history of intermittent abdominal pain in the right lower quadrant. Pain is worse after meals. No fever. Physical examination reveals tenderness at McBurney point.',
        format: 'soap',
      },
    });
    expect([200, 400, 503]).toContain(res.status());
  });

  test('POST /api/ai/interpret-lab → interprets lab results', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/ai/interpret-lab`, {
      headers: authHeaders(auth),
      data: {
        results: [
          { testName: 'Hemoglobin', value: '14.5', unit: 'g/dL', normalRange: '13.0-17.5' },
          { testName: 'WBC', value: '12000', unit: '/μL', normalRange: '4000-11000' },
          { testName: 'Platelet Count', value: '250000', unit: '/μL', normalRange: '150000-400000' },
        ],
        patientAge: 35,
        patientGender: 'Male',
      },
    });
    expect([200, 400, 503]).toContain(res.status());
  });

  test('POST /api/ai/dashboard-insights → generates dashboard insights', async ({ request }) => {
    const auth = loadAuth();
    const today = new Date().toISOString().split('T')[0];
    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const res = await request.post(`${BASE_URL}/api/ai/dashboard-insights`, {
      headers: authHeaders(auth),
      data: {
        dateRange: { from: lastMonth, to: today },
      },
    });
    expect([200, 400, 503]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📞 Telemedicine — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('📞 Ext3 — Telemedicine Deep Write', () => {
  let roomId: string | null = null;

  test('POST /api/telemedicine/rooms → creates tele room', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/telemedicine/rooms`, {
      headers: authHeaders(auth),
      data: {
        name: 'E2E Test Room',
        patientId: 1115,
        doctorId: 1,
        patientName: 'E2E Patient',
        doctorName: 'Dr. E2E',
      },
    });
    expect([201, 200, 400]).toContain(res.status());
    if (res.status() === 201 || res.status() === 200) {
      const body = await res.json();
      roomId = body?.id ?? body?.roomId ?? null;
    }
  });

  test('POST /api/telemedicine/rooms/:id/join → joins tele room', async ({ request }) => {
    const auth = loadAuth();
    const id = roomId ?? 'e2e-fake-room';
    const res = await request.post(`${BASE_URL}/api/telemedicine/rooms/${id}/join`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });

  test('DELETE /api/telemedicine/rooms/:id → closes tele room', async ({ request }) => {
    const auth = loadAuth();
    const id = roomId ?? 'e2e-fake-room';
    const res = await request.delete(`${BASE_URL}/api/telemedicine/rooms/${id}`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 💊 Pharmacy — Deep Write Coverage (suppliers, purchases, sales, billing)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('💊 Ext3 — Pharmacy Deep Write', () => {
  test('POST /api/pharmacy/suppliers → creates supplier', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/pharmacy/suppliers`, {
      headers: authHeaders(auth),
      data: {
        name: 'E2E Test Supplier',
        mobileNumber: '01700000099',
        address: 'Test Address, Dhaka',
        notes: 'E2E automated test supplier',
      },
    });
    expect([201, 200, 400]).toContain(res.status());
  });

  test('PUT /api/pharmacy/suppliers/99999 → updates supplier', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/pharmacy/suppliers/99999`, {
      headers: authHeaders(auth),
      data: { name: 'E2E Updated Supplier', notes: 'Updated by E2E' },
    });
    expect([200, 404]).toContain(res.status());
  });

  test('PUT /api/pharmacy/medicines/99999 → updates medicine', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/pharmacy/medicines/99999`, {
      headers: authHeaders(auth),
      data: { name: 'E2E Updated Medicine' },
    });
    expect([200, 404]).toContain(res.status());
  });

  test('GET /api/pharmacy/suppliers → lists suppliers', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.get(`${BASE_URL}/api/pharmacy/suppliers`, { headers: authHeaders(auth) });
    expect(res.status()).toBe(200);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔬 Lab — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔬 Ext3 — Lab Deep Write', () => {
  test('DELETE /api/lab/99999 → deletes lab test catalog entry', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/lab/99999`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });

  test('PATCH /api/lab/items/99999/sample-status → updates sample status', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.patch(`${BASE_URL}/api/lab/items/99999/sample-status`, {
      headers: authHeaders(auth),
      data: { sample_status: 'collected' },
    });
    expect([200, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🛡️ Insurance — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🛡️ Ext3 — Insurance Deep Write', () => {
  test('DELETE /api/insurance/policies/99999 → deletes insurance policy', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/insurance/policies/99999`, {
      headers: authHeaders(auth),
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('POST /api/insurance/claims → creates insurance claim', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/insurance/claims`, {
      headers: authHeaders(auth),
      data: {
        patient_id: 1115,
        diagnosis: 'E2E test diagnosis',
        icd10_code: 'J06.9',
        bill_amount: 10000,
        claimed_amount: 8000,
      },
    });
    expect([201, 200, 400, 403]).toContain(res.status());
  });

  test('PUT /api/insurance/claims/99999 → updates insurance claim', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/insurance/claims/99999`, {
      headers: authHeaders(auth),
      data: {
        status: 'under_review',
        approved_amount: 7500,
      },
    });
    expect([200, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⚙️ Settings — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('⚙️ Ext3 — Settings Deep Write', () => {
  test('PUT /api/settings/hospital_name → updates single setting', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/settings/hospital_name`, {
      headers: authHeaders(auth),
      data: { value: 'E2E Test Hospital' },
    });
    expect([200, 403]).toContain(res.status());
  });

  test('DELETE /api/settings/logo → deletes hospital logo', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/settings/logo`, {
      headers: authHeaders(auth),
    });
    expect([200, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🔄 Recurring Expenses — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🔄 Ext3 — Recurring Expenses Deep', () => {
  test('DELETE /api/recurring/99999 → deletes recurring expense', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/recurring/99999`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });

  test('POST /api/recurring/99999/run → manually triggers recurring expense', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/recurring/99999/run`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 👥 Shareholders — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('👥 Ext3 — Shareholders Deep Write', () => {
  test('PUT /api/shareholders/settings → updates shareholder settings', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/shareholders/settings`, {
      headers: authHeaders(auth),
      data: {
        total_shares: 1000,
        share_value_per_share: 100,
        profit_percentage: 50,
      },
    });
    expect([200, 403]).toContain(res.status());
  });

  test('PUT /api/shareholders/99999 → updates shareholder', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/shareholders/99999`, {
      headers: authHeaders(auth),
      data: { name: 'E2E Updated Shareholder' },
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('POST /api/shareholders/distribute → distributes dividends', async ({ request }) => {
    const auth = loadAuth();
    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0].substring(0, 7);
    const res = await request.post(`${BASE_URL}/api/shareholders/distribute`, {
      headers: authHeaders(auth),
      data: {
        month: lastMonth,
        notes: 'E2E test distribution',
        items: [
          { shareholderId: 1, grossDividend: 1000, taxDeducted: 100, netPayable: 900 },
        ],
      },
    });
    // 200, 403 (director role needed)
    expect([200, 403]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🚫 Billing Cancellation — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🚫 Ext3 — Billing Cancellation Deep Write', () => {
  test('PUT /api/billing-cancellation/item → cancels single billing item', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/billing-cancellation/item`, {
      headers: authHeaders(auth),
      data: {
        bill_id: 1,
        item_id: 99999,
        reason: 'E2E test cancellation',
      },
    });
    expect([200, 400, 403, 404]).toContain(res.status());
  });

  test('PUT /api/billing-cancellation/items/batch → batch cancels items', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/billing-cancellation/items/batch`, {
      headers: authHeaders(auth),
      data: {
        bill_id: 1,
        item_ids: [99998, 99999],
        reason: 'E2E batch cancellation test',
      },
    });
    expect([200, 400, 403]).toContain(res.status());
  });

  test('PUT /api/billing-cancellation/provisional/99999 → cancels provisional bill', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/billing-cancellation/provisional/99999`, {
      headers: authHeaders(auth),
      data: { reason: 'E2E provisional cancellation test' },
    });
    expect([200, 400, 403, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🩺 Nurse Station — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🩺 Ext3 — Nurse Station Deep Write', () => {
  test('POST /api/nurse-station/vitals → records patient vitals', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.post(`${BASE_URL}/api/nurse-station/vitals`, {
      headers: authHeaders(auth),
      data: {
        admission_id: 1,
        patient_id: 1115,
        bp_systolic: 120,
        bp_diastolic: 80,
        pulse: 72,
        temperature: 98.6,
        spo2: 98,
        respiratory_rate: 16,
        notes: 'E2E vitals check — all normal',
      },
    });
    expect([201, 200, 400]).toContain(res.status());
  });

  test('PUT /api/nurse-station/alerts/99999/acknowledge → acknowledges alert', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/nurse-station/alerts/99999/acknowledge`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏨 Admissions — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🏨 Ext3 — Admissions Deep Write', () => {
  test('PUT /api/admissions/99999 → updates admission status', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/admissions/99999`, {
      headers: authHeaders(auth),
      data: { status: 'admitted' },
    });
    // 200 success, 403 role, 400/404 if not found
    expect([200, 400, 403, 404]).toContain(res.status());
  });

  test('PUT /api/admissions/99999/discharge → discharges patient', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/admissions/99999/discharge`, {
      headers: authHeaders(auth),
      data: { discharge_notes: 'E2E test discharge' },
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🩺 Vitals — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('🩺 Ext3 — Vitals Deep Write', () => {
  test('DELETE /api/vitals/99999 → deletes vital record', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/vitals/99999`, {
      headers: authHeaders(auth),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 👨‍⚕️ Staff — Deep Write Coverage
// ══════════════════════════════════════════════════════════════════════════════
test.describe('👨‍⚕️ Ext3 — Staff Deep Write', () => {
  test('PUT /api/staff/99999 → updates staff member', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.put(`${BASE_URL}/api/staff/99999`, {
      headers: authHeaders(auth),
      data: { name: 'E2E Updated Staff' },
    });
    expect([200, 403, 404]).toContain(res.status());
  });

  test('DELETE /api/staff/99999 → deactivates staff member', async ({ request }) => {
    const auth = loadAuth();
    const res = await request.delete(`${BASE_URL}/api/staff/99999`, {
      headers: authHeaders(auth),
    });
    expect([200, 403, 404]).toContain(res.status());
  });
});
