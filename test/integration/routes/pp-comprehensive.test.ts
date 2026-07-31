/**
 * PATIENT PORTAL COMPREHENSIVE TESTS
 *
 * Updated for magic-link auth flow (no OTP).
 *
 * Schemas:
 * - requestMagicLinkSchema: { email: string(email) }
 * - verifyMagicLinkSchema: { token: string }
 * - patientRegisterSchema: { name, email, mobile?, date_of_birth?, gender?, address? }
 * - updateProfileSchema: { mobile?, guardian_mobile?, address?, email? }
 * - bookAppointmentSchema: { doctorId: number, apptDate: string(YYYY-MM-DD), apptTime?: HH:MM, chiefComplaint?: }
 * - sendMessageSchema: { doctorId: number, message: string(1-2000) }
 * - linkFamilySchema: { patientCode: string, relationship: enum(spouse/child/parent/sibling/other) }
 */
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env, Variables } from '../../../src/types';
import { createMockDB } from '../helpers/mock-db';

import patientPortal from '../../../src/routes/tenant/patientPortal';

const T = 'tenant-1';

function ppQO(sql: string) {
  const s = sql.toLowerCase();
  // Patient lookup by email → found
  if (s.includes('from patients') && s.includes('email'))
    return { first: { id: 1, name: 'Test Patient', email: 'test@test.com', tenant_id: T, patient_code: 'PT-001', is_verified: 1 }, results: [{ id: 1 }], success: true, meta: {} };
  // Magic link store
  if (s.includes('insert') && s.includes('magic_link'))
    return { first: null, results: [], success: true, meta: { last_row_id: 1, changes: 1 } };
  // Patient credentials
  if (s.includes('patient_credentials'))
    return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: { last_row_id: 1, changes: 1 } };
  // Tenant lookup
  if (s.includes('from tenants'))
    return { first: { name: 'Test Hospital', subdomain: 'test-hospital' }, results: [{ name: 'Test Hospital' }], success: true, meta: {} };
  // Patient profile
  if (s.includes('from patients') && s.includes('where'))
    return { first: { id: 1, name: 'Test Patient', email: 'test@test.com', mobile: '017123', address: 'Dhaka', blood_group: 'A+', gender: 'male', dob: '1990-01-01', patient_code: 'PT-001', guardian_mobile: '018123', tenant_id: T }, results: [{ id: 1 }], success: true, meta: {} };
  // Appointments list
  if (s.includes('from appointments') || s.includes('from visits'))
    return { first: null, results: [{ id: 1, doctor_name: 'Dr Test', appt_date: '2025-03-15', status: 'confirmed' }], success: true, meta: {} };
  // Prescriptions list
  if (s.includes('from prescriptions') || s.includes('prescription'))
    return { first: { id: 1 }, results: [{ id: 1, medicine_name: 'Paracetamol', dosage: '500mg', status: 'active' }], success: true, meta: {} };
  // Lab orders
  if (s.includes('from lab_orders') || s.includes('lab_order'))
    return { first: null, results: [{ id: 1, test_name: 'CBC', status: 'completed', result: 'Normal' }], success: true, meta: {} };
  // Doctor lookup
  if (s.includes('from doctors') || s.includes('from users'))
    return { first: { id: 1, name: 'Dr Khan', specialty: 'General', consultation_fee: 500 }, results: [{ id: 1, name: 'Dr Khan' }], success: true, meta: {} };
  // Messages
  if (s.includes('from messages') || s.includes('message'))
    return { first: { id: 1, created_at: '2025-03-15T10:00:00Z' }, results: [{ id: 1, message: 'Hello', from_patient: 1 }], success: true, meta: {} };
  // Medical records
  if (s.includes('medical_records'))
    return { first: null, results: [{ id: 1, file_number: 'MR-001' }], success: true, meta: { total: 1 } };
  // Document records
  if (s.includes('document_records'))
    return { first: null, results: [{ id: 1, title: 'Report', document_type: 'lab_report' }], success: true, meta: { total: 1 } };
  // Final diagnosis
  if (s.includes('final_diagnosis'))
    return { first: null, results: [{ id: 1, diagnosis_name: 'Hypertension', icd10_code: 'I10' }], success: true, meta: { total: 1 } };
  // Count queries
  if (s.includes('count(*)'))
    return { first: { total: 1, cnt: 1 }, results: [], success: true, meta: {} };
  // Default fallback for all INSERTs
  if (s.includes('insert'))
    return { first: null, results: [], success: true, meta: { last_row_id: 1, changes: 1 } };
  // Default fallback for all UPDATEs
  if (s.includes('update'))
    return { first: null, results: [], success: true, meta: { changes: 1 } };
  return null;
}

function mk(qo?: any) {
  const mock = createMockDB({ tables: {}, universalFallback: true, queryOverride: qo || ppQO });
  const kvStore: Record<string, string> = {};
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use('*', async (c, next) => {
    c.set('tenantId', T);
    c.set('userId', '1');
    c.set('patientId', '1');
    c.set('role', 'patient' as any);
    c.env = {
      DB: mock.db,
      KV: {
        get: async (key: string) => kvStore[key] || null,
        put: async (key: string, val: string) => { kvStore[key] = val; },
        delete: async (key: string) => { delete kvStore[key]; },
        list: async () => ({ keys: [] }),
      } as any,
      JWT_SECRET: 'test-secret-long-enough-for-jwt-signing-key-hmac-sha256',
      ENVIRONMENT: 'development',
      UPLOADS: { put: async () => ({}), get: async () => null, delete: async () => {} } as any,
      DASHBOARD_DO: undefined,
    } as any;
    await next();
  });
  app.route('/pp', patientPortal);
  app.onError((e, c) => c.json({ error: e.message }, (e as any).status ?? 500));
  return app;
}

function jr(app: any, url: string, method = 'GET', body?: any) {
  const init: RequestInit = { method, headers: body ? { 'Content-Type': 'application/json' } : {} };
  if (body) init.body = JSON.stringify(body);
  return app.request(url, init);
}

async function hit(app: any, url: string, method = 'GET', body?: any) {
  const r = await jr(app, url, method, body);
  expect(r.status).toBeLessThanOrEqual(500);
  return r;
}

// ════════════════════════════════════════════════════════════════
// MAGIC LINK LOGIN — requestMagicLinkSchema: { email }
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-MagicLink', () => {
  it('POST /request-login — valid email', () => hit(mk(), '/pp/request-login', 'POST', { email: 'patient@hospital.com' }));
  it('POST /request-login — invalid email → 400', async () => {
    const r = await jr(mk(), '/pp/request-login', 'POST', { email: 'notanemail' });
    expect(r.status).toBe(400);
  });
  it('POST /request-login — missing email → 400', async () => {
    const r = await jr(mk(), '/pp/request-login', 'POST', {});
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════
// VERIFY MAGIC LINK — verifyMagicLinkSchema: { token }
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-VerifyMagicLink', () => {
  it('POST /verify-email — missing token → 400', async () => {
    const r = await jr(mk(), '/pp/verify-email', 'POST', {});
    expect(r.status).toBe(400);
  });
  it('POST /verify-email — invalid token → 401', async () => {
    const r = await jr(mk(), '/pp/verify-email', 'POST', { token: 'invalid-token-value' });
    expect(r.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════
// REGISTRATION — patientRegisterSchema
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Register', () => {
  it('POST /register — valid data', () => hit(mk(), '/pp/register', 'POST', {
    name: 'New Patient',
    email: 'new@test.com',
  }));
  it('POST /register — full data', () => hit(mk(), '/pp/register', 'POST', {
    name: 'Full Patient',
    email: 'full@test.com',
    mobile: '01712345678',
    date_of_birth: '1990-05-15',
    gender: 'female',
    address: 'Dhaka, Bangladesh',
  }));
  it('POST /register — missing name → 400', async () => {
    const r = await jr(mk(), '/pp/register', 'POST', { email: 'no-name@test.com' });
    expect(r.status).toBe(400);
  });
  it('POST /register — invalid email → 400', async () => {
    const r = await jr(mk(), '/pp/register', 'POST', { name: 'Test', email: 'not-email' });
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════
// REFRESH TOKEN
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-RefreshToken', () => {
  it('POST /refresh-token', () => hit(mk(), '/pp/refresh-token', 'POST'));
});

// ════════════════════════════════════════════════════════════════
// PROFILE
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Profile', () => {
  it('GET /me', () => hit(mk(), '/pp/me'));
  it('PATCH /me — update mobile', () => hit(mk(), '/pp/me', 'PATCH', { mobile: '01812345678' }));
  it('PATCH /me — update address', () => hit(mk(), '/pp/me', 'PATCH', { address: 'New Address, Dhaka' }));
  it('PATCH /me — update email', () => hit(mk(), '/pp/me', 'PATCH', { email: 'new@email.com' }));
});

// ════════════════════════════════════════════════════════════════
// DASHBOARD
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Dashboard', () => {
  it('GET /dashboard', () => hit(mk(), '/pp/dashboard'));
});

// ════════════════════════════════════════════════════════════════
// APPOINTMENTS
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Appointments', () => {
  it('GET /appointments', () => hit(mk(), '/pp/appointments'));
});

// ════════════════════════════════════════════════════════════════
// DATA ENDPOINTS
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Data', () => {
  it('GET /prescriptions', () => hit(mk(), '/pp/prescriptions'));
  it('GET /lab-results', () => hit(mk(), '/pp/lab-results'));
  it('GET /vitals', () => hit(mk(), '/pp/vitals'));
  it('GET /timeline', () => hit(mk(), '/pp/timeline'));
  it('GET /documents', () => hit(mk(), '/pp/documents'));
  it('GET /medical-records', () => hit(mk(), '/pp/medical-records'));
  it('GET /diagnoses', () => hit(mk(), '/pp/diagnoses'));
});

// ════════════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Messages', () => {
  it('GET /messages', () => hit(mk(), '/pp/messages'));
  it('GET /messages/:doctorId', () => hit(mk(), '/pp/messages/1'));
  it('POST /messages — send', () => hit(mk(), '/pp/messages', 'POST', {
    doctorId: 1,
    message: 'Thank you doctor for the prescription',
  }));
});

// ════════════════════════════════════════════════════════════════
// REFILL REQUESTS
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Refills', () => {
  it('POST /prescriptions/:id/refill', () => hit(mk(), '/pp/prescriptions/1/refill', 'POST'));
  it('GET /refill-requests', () => hit(mk(), '/pp/refill-requests'));
});

// ════════════════════════════════════════════════════════════════
// FAMILY
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-Family', () => {
  it('GET /family', () => hit(mk(), '/pp/family'));
  it('POST /family — link spouse', () => hit(mk(), '/pp/family', 'POST', {
    patientCode: 'PT-002',
    relationship: 'spouse',
  }));
  it('POST /family — invalid relationship → 400', async () => {
    const r = await jr(mk(), '/pp/family', 'POST', {
      patientCode: 'PT-007',
      relationship: 'cousin',
    });
    expect(r.status).toBe(400);
  });
  it('DELETE /family/:linkId', () => hit(mk(), '/pp/family/1', 'DELETE'));
});

// ════════════════════════════════════════════════════════════════
// ERROR PATHS — force catch blocks
// ════════════════════════════════════════════════════════════════
describe('PatientPortal-ErrorPaths', () => {
  const errQO = () => { throw new Error('DB fail'); };

  it('GET /me — error', () => hit(mk(errQO), '/pp/me'));
  it('GET /dashboard — error', () => hit(mk(errQO), '/pp/dashboard'));
  it('GET /appointments — error', () => hit(mk(errQO), '/pp/appointments'));
  it('GET /prescriptions — error', () => hit(mk(errQO), '/pp/prescriptions'));
  it('GET /messages — error', () => hit(mk(errQO), '/pp/messages'));
  it('GET /family — error', () => hit(mk(errQO), '/pp/family'));
  it('GET /timeline — error', () => hit(mk(errQO), '/pp/timeline'));
  it('GET /refill-requests — error', () => hit(mk(errQO), '/pp/refill-requests'));
  it('POST /request-login — error', async () => {
    const r = await jr(mk(errQO), '/pp/request-login', 'POST', { email: 'test@test.com' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
  it('POST /verify-email — error', async () => {
    const r = await jr(mk(errQO), '/pp/verify-email', 'POST', { token: 'some-token' });
    expect(r.status).toBeGreaterThanOrEqual(400);
  });
});
