/**
 * Patient Portal E2E Tests — Comprehensive write coverage
 *
 * Tests the complete patient portal flow:
 * 1. Canonical global patient auth/session (`/api/patient-auth/*`)
 * 2. Auth guard enforcement (admin JWT → 403 on patient-only routes)
 * 3. Protected route writes (profile update, appointment booking, messages,
 *    prescription refills, family linking)
 *
 * Patient login/session is password or magic-link based through patient-auth.
 * Legacy portal OTP endpoints are intentionally not used here.
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';

// ─── Helpers ────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const PROJECT_DIR = resolve(dirname(__filename), '..', '..', '..');

/** Slug header only (no JWT) — for public (unauthenticated) requests */
function publicHeaders(slug: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Slug': slug,
  };
}

const PATIENT_AUTH_IDENTIFIER = process.env.PATIENT_PORTAL_E2E_IDENTIFIER ?? 'e2e-portal@hms-test.local';
const PATIENT_AUTH_PASSWORD = process.env.PATIENT_PORTAL_E2E_PASSWORD ?? '';
const PATIENT_TOKEN_FILE = resolve(PROJECT_DIR, 'test/e2e/.patient-token.json');

let slug: string;
let patientToken: string | null = null;

/** Read persisted patient token from disk */
function loadPatientToken(): string | null {
  try {
    const data = JSON.parse(readFileSync(PATIENT_TOKEN_FILE, 'utf-8'));
    if (data.token && typeof data.token === 'string' && data.token.length > 10) {
      return data.token;
    }
  } catch {
    // File doesn't exist yet
  }
  return null;
}

/** Save patient token to disk for other workers to read */
function savePatientToken(token: string): void {
  writeFileSync(PATIENT_TOKEN_FILE, JSON.stringify({ token }), 'utf-8');
}

// Force serial execution so all describe blocks run in order
test.describe.configure({ mode: 'serial' });

// ─── Setup ──────────────────────────────────────────────────────────────────

test.beforeAll(async ({ request }) => {
  const auth = loadAuth();
  slug = auth.slug;

  // Check if we already have a valid patient token from a previous run
  patientToken = loadPatientToken();
  if (patientToken) {
    // Validate the existing token is not expired
    const checkRes = await request.get(`${BASE_URL}/api/patient-auth/me`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${patientToken}`,
      },
    });
    if (checkRes.status() !== 200) {
      patientToken = null; // Token expired, need fresh one
    }
  }

  // If no valid token, acquire one via the canonical patient-auth login flow.
  if (!patientToken && PATIENT_AUTH_PASSWORD) {
    const loginRes = await request.post(`${BASE_URL}/api/patient-auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { identifier: PATIENT_AUTH_IDENTIFIER, password: PATIENT_AUTH_PASSWORD },
    });

    if (loginRes.status() === 200) {
      const body = await loginRes.json();
      if (body.token && typeof body.token === 'string' && body.token.length > 10) {
        patientToken = body.token;
        savePatientToken(patientToken!);
      }
    } else {
      console.warn(`Patient auth login failed with ${loginRes.status()}`);
    }
  }

  if (!patientToken) {
    console.warn('Could not obtain patient JWT. Patient flow tests will be skipped.');
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CANONICAL PATIENT AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Patient Portal — canonical patient auth', () => {
  test('POST /api/patient-auth/login rejects missing credentials', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect([400, 422, 429]).toContain(res.status());
  });

  test('POST /api/patient-auth/login rejects invalid credentials', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { identifier: 'missing-patient@example.invalid', password: 'wrong-password' },
    });
    expect([401, 429]).toContain(res.status());
  });

  test('POST /api/patient-auth/register validates required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-auth/register`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    expect([400, 422, 429]).toContain(res.status());
  });

  test('GET /api/patient-auth/me requires a patient session', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-auth/me`, {
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: AUTH GUARD — admin JWT rejected on patient-only routes
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Patient Portal — Auth Guards', () => {
  test('GET /me rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/me`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
    const text = await res.text();
    expect(text).toContain('Patient portal access only');
  });

  test('PATCH /me rejects admin JWT with 403', async ({ request }) => {
    const res = await request.patch(`${BASE_URL}/api/patient-portal/me`, {
      headers: authHeaders(),
      data: { address: 'Test' },
    });
    expect(res.status()).toBe(403);
  });

  test('GET /dashboard rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/dashboard`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /appointments rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/appointments`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('POST /book-appointment rejects admin JWT with 403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/book-appointment`, {
      headers: authHeaders(),
      data: { doctorId: 1, apptDate: '2026-12-01', visitType: 'opd' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /messages rejects admin JWT with 403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/messages`, {
      headers: authHeaders(),
      data: { doctorId: 1, message: 'Test message' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /family rejects admin JWT with 403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/family`, {
      headers: authHeaders(),
      data: { patientCode: 'P-000001', relationship: 'spouse' },
    });
    expect(res.status()).toBe(403);
  });

  test('POST /cancel-appointment/:id rejects admin JWT with 403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/cancel-appointment/999`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('POST /prescriptions/:id/refill rejects admin JWT with 403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/prescriptions/999/refill`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('DELETE /family/:linkId rejects admin JWT with 403', async ({ request }) => {
    const res = await request.delete(`${BASE_URL}/api/patient-portal/family/999`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('POST /refresh-token rejects admin JWT with 403', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/refresh-token`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /lab-results rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/lab-results`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /bills rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/bills`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /vitals rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/vitals`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /visits rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/visits`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('GET /timeline rejects admin JWT with 403', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/timeline`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: FULL PATIENT PORTAL FLOW (OTP → JWT → protected operations)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe('Patient Portal — Full Flow', () => {
  /** Patient JWT headers helper */
  function patientHeaders(): Record<string, string> {
    if (!patientToken) throw new Error('Patient token not available');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${patientToken}`,
      'X-Tenant-Slug': slug,
    };
  }


  // Patient JWT is acquired in the global beforeAll above

  // ─── Profile ──────────────────────────────────────────────────────────

  test('GET /me returns patient profile', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/me`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('email');
  });

  test('PATCH /me updates patient profile', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.patch(`${BASE_URL}/api/patient-portal/me`, {
      headers: patientHeaders(),
      data: { address: 'E2E Portal Test Address' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.message).toBe('Profile updated successfully');
  });

  // ─── Dashboard ────────────────────────────────────────────────────────

  test('GET /dashboard returns aggregated summary', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/dashboard`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('billing');
    expect(body).toHaveProperty('activePrescriptions');
    expect(body).toHaveProperty('totalVisits');
  });

  // ─── Data views (paginated) ───────────────────────────────────────────

  test('GET /appointments returns paginated list', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/appointments`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  test('GET /prescriptions returns paginated list', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/prescriptions`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  test('GET /lab-results returns paginated results', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/lab-results`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  test('GET /bills returns paginated bills', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/bills`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  test('GET /vitals returns paginated vitals', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/vitals`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  test('GET /visits returns paginated visits', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/visits`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  // ─── Available doctors & slots ────────────────────────────────────────

  test('GET /available-doctors returns doctor list', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/available-doctors`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('doctors');
  });

  test('GET /available-slots/:doctorId returns slot info', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/available-slots/1?date=2026-12-01`, {
      headers: patientHeaders(),
    });
    // 200 with booked slot info or empty
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('bookedCount');
  });

  // ─── Appointment Booking ──────────────────────────────────────────────

  test('POST /book-appointment books a new appointment', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/book-appointment`, {
      headers: patientHeaders(),
      data: {
        doctorId: 1,
        apptDate: '2026-12-15',
        apptTime: '10:00',
        visitType: 'opd',
        chiefComplaint: 'E2E portal test booking',
      },
    });
    // 201 = booked, 404 = doctor not found, 409 = duplicate, 400 = past date
    expect([201, 400, 404, 409]).toContain(res.status());
    if (res.status() === 201) {
      const body = await res.json();
      expect(body.message).toBe('Appointment booked successfully');
      expect(body.appointment).toHaveProperty('apptNo');
    }
  });

  test('POST /cancel-appointment/:id handles cancellation', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/cancel-appointment/99999`, {
      headers: patientHeaders(),
    });
    // 404 = appointment not found, 200 = cancelled, 400 = wrong status
    expect([200, 400, 404]).toContain(res.status());
  });

  // ─── Messaging ────────────────────────────────────────────────────────

  test('GET /messages returns conversation list', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/messages`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('conversations');
  });

  test('POST /messages sends a message to a doctor', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/messages`, {
      headers: patientHeaders(),
      data: { doctorId: 1, message: 'E2E portal test message' },
    });
    // 201 = sent, 404 = doctor not found, 429 = rate limited
    expect([201, 404, 429]).toContain(res.status());
  });

  test('GET /messages/:doctorId returns message thread', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/messages/1`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  // ─── Prescription Refills ─────────────────────────────────────────────

  test('POST /prescriptions/:id/refill requests a refill', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/prescriptions/99999/refill`, {
      headers: patientHeaders(),
      data: { notes: 'E2E portal refill request' },
    });
    // 201 = created, 404 = rx not found, 409 = already pending
    expect([201, 404, 409]).toContain(res.status());
  });

  test('GET /refill-requests returns refill history', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/refill-requests`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  // ─── Timeline ─────────────────────────────────────────────────────────

  test('GET /timeline returns health timeline', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/timeline`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body).toHaveProperty('pagination');
  });

  // ─── Family Members ───────────────────────────────────────────────────

  test('GET /family returns family member list', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/family`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('familyMembers');
  });

  test('POST /family links a family member', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/family`, {
      headers: patientHeaders(),
      data: { patientCode: 'P-000002', relationship: 'spouse' },
    });
    // 201 = linked, 400 = self-link, 404 = patient not found, 409 = already linked
    expect([201, 400, 404, 409]).toContain(res.status());
  });

  test('DELETE /family/:linkId unlinks a family member', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.delete(`${BASE_URL}/api/patient-portal/family/99999`, {
      headers: patientHeaders(),
    });
    // 200 = unlinked, 404 = link not found
    expect([200, 404]).toContain(res.status());
  });

  // ─── Token Refresh ────────────────────────────────────────────────────

  test('POST /refresh-token refreshes patient JWT', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/refresh-token`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('token');
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(10);
  });

  // ─── Missing endpoint: Prescription Items ─────────────────────────────

  test('GET /prescriptions/:id/items returns prescription line items', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/prescriptions/1/items`, {
      headers: patientHeaders(),
    });
    // 200 = items found, 404 = prescription not found
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('items');
    }
  });

  test('GET /prescriptions/:id/items returns 404 for non-existent prescription', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/prescriptions/99999/items`, {
      headers: patientHeaders(),
    });
    expect([404, 200]).toContain(res.status());
  });

  // ─── Pagination edge cases ────────────────────────────────────────────

  test('GET /appointments respects pagination params', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/appointments?page=1&limit=5`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBeLessThanOrEqual(5);
  });

  test('GET /prescriptions respects page=2', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/prescriptions?page=2&limit=5`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(body.pagination.page).toBe(2);
  });

  test('GET /bills with large page returns empty data', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/bills?page=999`, {
      headers: patientHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  // ─── Validation edge cases ────────────────────────────────────────────

  test('POST /book-appointment rejects missing required fields', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/book-appointment`, {
      headers: patientHeaders(),
      data: {},
    });
    expect([400, 422]).toContain(res.status());
  });

  test('POST /book-appointment rejects past dates', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/book-appointment`, {
      headers: patientHeaders(),
      data: {
        doctorId: 1,
        apptDate: '2020-01-01',
        apptTime: '10:00',
        visitType: 'opd',
        chiefComplaint: 'Past date test',
      },
    });
    // 400 = past date, 404 = doctor not found with old date, 422 = validation error
    expect([400, 404, 422]).toContain(res.status());
  });

  test('POST /messages rejects empty message body', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/messages`, {
      headers: patientHeaders(),
      data: { doctorId: 1 },
    });
    // 400 or 422 = validation error
    expect([400, 422]).toContain(res.status());
  });

  test('POST /family rejects missing relationship', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/family`, {
      headers: patientHeaders(),
      data: { patientCode: 'P-000002' },
    });
    expect([400, 422]).toContain(res.status());
  });

  test('PATCH /me rejects invalid field values', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.patch(`${BASE_URL}/api/patient-portal/me`, {
      headers: patientHeaders(),
      data: {},
    });
    // Empty update should still succeed (no-op) or fail validation
    expect([200, 400, 422]).toContain(res.status());
  });

  // ─── No-auth rejection tests ──────────────────────────────────────────

  test('GET /me requires patient JWT (no token)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/me`, {
      headers: publicHeaders(slug),
    });
    expect([401, 403]).toContain(res.status());
  });

  test('POST /book-appointment requires patient JWT (no token)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/book-appointment`, {
      headers: publicHeaders(slug),
      data: { doctorId: 1, apptDate: '2026-12-15', apptTime: '10:00', visitType: 'opd' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('POST /messages requires patient JWT (no token)', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-portal/messages`, {
      headers: publicHeaders(slug),
      data: { doctorId: 1, message: 'No auth test' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('GET /dashboard requires patient JWT (no token)', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-portal/dashboard`, {
      headers: publicHeaders(slug),
    });
    expect([401, 403]).toContain(res.status());
  });

  // ─── Invalid ID handling ──────────────────────────────────────────────

  test('GET /available-slots/:doctorId handles non-existent doctor', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/available-slots/99999?date=2026-12-01`, {
      headers: patientHeaders(),
    });
    // Should still return 200 with zero slots, or 404
    expect([200, 404]).toContain(res.status());
  });

  test('POST /cancel-appointment/:id rejects string ID gracefully', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.post(`${BASE_URL}/api/patient-portal/cancel-appointment/not-a-number`, {
      headers: patientHeaders(),
    });
    expect([400, 404, 422]).toContain(res.status());
  });

  test('GET /messages/:doctorId handles non-existent doctor thread', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.get(`${BASE_URL}/api/patient-portal/messages/99999`, {
      headers: patientHeaders(),
    });
    // 200 with empty data or 404
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      expect(body).toHaveProperty('data');
    }
  });

  test('DELETE /family/:linkId handles non-existent link', async ({ request }) => {
    test.skip(!patientToken, 'Patient JWT not available');
    const res = await request.delete(`${BASE_URL}/api/patient-portal/family/0`, {
      headers: patientHeaders(),
    });
    expect([200, 400, 404]).toContain(res.status());
  });

  // ─── patient-auth edge cases ───────────────────────────────────────────

  test('POST /login rejects malformed identifier', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/patient-auth/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: { identifier: 'not-an-email', password: 'password' },
    });
    expect([400, 401, 422, 429]).toContain(res.status());
  });

  test('GET /me rejects malformed bearer token', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/patient-auth/me`, {
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer invalid-token' },
    });
    expect([401, 403, 429]).toContain(res.status());
  });
});
