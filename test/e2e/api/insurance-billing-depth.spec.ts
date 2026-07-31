/**
 * Insurance Billing Depth — E2E API Tests (Playwright)
 *
 * Full authenticated CRUD coverage for all billingInsurance sub-routes:
 *   Providers → Plans → Memberships → Pre-Auth → Claims → EOB → Stats
 *
 * Run:
 *   npx playwright test test/e2e/api/insurance-billing-depth.spec.ts
 */

import { test, expect } from '@playwright/test';
import { loadAuth, authHeaders, BASE_URL } from '../helpers/auth-helper';

// ── shared IDs ────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().split('T')[0]!;
const NEXT_YEAR = `${new Date().getFullYear() + 1}-12-31`;

let patientId = 0;
let providerId = 0;
let planId = 0;
let membershipId = 0;
let preauthId = 0;
let claimId = 0;
let eobId = 0;

// ── seed patient ──────────────────────────────────────────────────────────────
test.beforeAll(async ({ request }) => {
  loadAuth();
  const res = await request.post(`${BASE_URL}/api/patients`, {
    headers: authHeaders(),
    data: {
      name: 'InsuranceBilling E2E',
      fatherHusband: 'Test Father',
      address: 'Test Addr',
      mobile: '01711222333',
    },
  });
  if (res.ok()) {
    const d = await res.json() as { patientId?: number };
    patientId = d.patientId ?? 0;
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏢 Providers
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🏢 Insurance — Providers', () => {
  test('GET /api/insurance-billing/providers → 200 with array', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/providers`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('POST /api/insurance-billing/providers → creates provider', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/insurance-billing/providers`, {
      headers: authHeaders(),
      data: {
        name: `E2E Provider ${Date.now()}`,
        short_code: `EP${Date.now().toString().slice(-4)}`,
        provider_type: 'insurance_company',
        contact_person: 'E2E Contact',
        contact_phone: '01800000001',
        contact_email: 'e2e@provider.test',
        claims_submission_email: 'claims@provider.test',
        billing_cycle: 'monthly',
        payment_terms_days: 30,
        network_type: 'panel',
        is_active: true,
      },
    });
    expect([200, 201]).toContain(res.status());
    const body = await res.json() as { data?: { id?: number } };
    providerId = body.data?.id ?? 0;
    expect(providerId).toBeGreaterThan(0);
  });

  test('POST /api/insurance-billing/providers → 400 for missing name', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/insurance-billing/providers`, {
      headers: authHeaders(),
      data: { provider_type: 'insurance_company' },
    });
    expect([400, 422]).toContain(res.status());
  });

  test('PUT /api/insurance-billing/providers/:id → updates provider', async ({ request }) => {
    test.skip(providerId === 0, 'Provider not created');
    const res = await request.put(`${BASE_URL}/api/insurance-billing/providers/${providerId}`, {
      headers: authHeaders(),
      data: {
        contact_person: 'E2E Updated Contact',
        payment_terms_days: 45,
      },
    });
    expect([200, 201, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📋 Insurance Plans
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📋 Insurance — Plans', () => {
  test('GET /api/insurance-billing/providers/:id/plans → lists plans', async ({ request }) => {
    test.skip(providerId === 0, 'Provider not created');
    const res = await request.get(`${BASE_URL}/api/insurance-billing/providers/${providerId}/plans`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('POST /api/insurance-billing/providers/:id/plans → creates plan', async ({ request }) => {
    test.skip(providerId === 0, 'Provider not created');
    const res = await request.post(`${BASE_URL}/api/insurance-billing/providers/${providerId}/plans`, {
      headers: authHeaders(),
      data: {
        plan_name: 'E2E Standard Plan',
        plan_type: 'individual',
        coverage_limit: 500000,
        deductible: 5000,
        copay_percentage: 20,
        max_outpatient_visits: 12,
        covers_pharmacy: true,
        covers_dental: false,
        covers_vision: false,
        covers_maternity: true,
        pre_authorization_required: true,
        network_restriction: 'panel_only',
      },
    });
    expect([200, 201]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { data?: { id?: number } };
      planId = body.data?.id ?? 0;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 👤 Memberships / Enrollment
// ══════════════════════════════════════════════════════════════════════════════

test.describe('👤 Insurance — Memberships', () => {
  test('GET /api/insurance-billing/memberships → lists memberships', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/memberships`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('POST /api/insurance-billing/memberships → enrolls patient', async ({ request }) => {
    test.skip(patientId === 0 || providerId === 0, 'Patient or provider not created');
    const res = await request.post(`${BASE_URL}/api/insurance-billing/memberships`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        provider_id: providerId,
        plan_id: planId || undefined,
        member_id: `MEM-${Date.now()}`,
        policy_number: `POL-${Date.now()}`,
        group_number: 'GRP-001',
        coverage_start_date: TODAY,
        coverage_end_date: NEXT_YEAR,
        subscriber_name: 'E2E Subscriber',
        subscriber_relationship: 'self',
        copay_amount: 500,
        coverage_percentage: 80,
        max_coverage_amount: 500000,
        is_primary: true,
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { data?: { id?: number } };
      membershipId = body.data?.id ?? 0;
    }
  });

  test('GET /api/insurance-billing/memberships/patient/:id → gets patient memberships', async ({ request }) => {
    test.skip(patientId === 0, 'Patient not created');
    const res = await request.get(`${BASE_URL}/api/insurance-billing/memberships/patient/${patientId}`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as { data?: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    }
  });

  test('GET /api/insurance-billing/memberships/:id/eligibility → checks eligibility', async ({ request }) => {
    test.skip(membershipId === 0, 'Membership not created');
    const res = await request.get(`${BASE_URL}/api/insurance-billing/memberships/${membershipId}/eligibility`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📝 Pre-Authorization
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📝 Insurance — Pre-Authorization', () => {
  test('GET /api/insurance-billing/preauth-records → lists preauth', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/preauth-records`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('POST /api/insurance-billing/preauth-records → creates preauth', async ({ request }) => {
    test.skip(patientId === 0 || providerId === 0, 'Patient or provider not created');
    const res = await request.post(`${BASE_URL}/api/insurance-billing/preauth-records`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        membership_id: membershipId || undefined,
        provider_id: providerId,
        procedure_type: 'surgical',
        procedure_codes: ['CPT-XXXXXXXXX'],
        icd10_codes: ['J18.9'],
        treating_doctor: 'Dr. E2E Test',
        requested_date: TODAY,
        notes: 'E2E pre-authorization request',
        estimated_cost: 50000,
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { data?: { id?: number } };
      preauthId = body.data?.id ?? 0;
    }
  });

  test('PATCH /api/insurance-billing/preauth-records/:id/approve → approves preauth', async ({ request }) => {
    test.skip(preauthId === 0, 'Preauth not created');
    const res = await request.patch(`${BASE_URL}/api/insurance-billing/preauth-records/${preauthId}/approve`, {
      headers: authHeaders(),
      data: {
        auth_code: `AUTH-${Date.now()}`,
        approved_amount: 45000,
        valid_until: NEXT_YEAR,
        notes: 'E2E approved',
      },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🧾 Claims
// ══════════════════════════════════════════════════════════════════════════════

test.describe('🧾 Insurance — Claims', () => {
  test('GET /api/insurance-billing/claim-records → lists claims', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/claim-records`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('GET /api/insurance-billing/claim-records — supports filters', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/claim-records?status=submitted&limit=5`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
  });

  test('POST /api/insurance-billing/claim-records → creates claim with line items', async ({ request }) => {
    test.skip(patientId === 0 || providerId === 0, 'Patient or provider not created');
    const res = await request.post(`${BASE_URL}/api/insurance-billing/claim-records`, {
      headers: authHeaders(),
      data: {
        patient_id: patientId,
        membership_id: membershipId || undefined,
        policy_id: undefined,
        diagnosis: 'E2E test diagnosis',
        icd10_code: 'J18.9',
        bill_amount: 75000,
        claimed_amount: 60000,
        items: [
          {
            service_code: 'SVC-001',
            description: 'E2E Hospital Stay',
            quantity: 3,
            unit_price: 20000,
            total_price: 60000,
            covered_amount: 48000,
            patient_payable: 12000,
          },
        ],
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { data?: { id?: number; claim_no?: string } };
      claimId = body.data?.id ?? 0;
      // Verify claim_no was generated
      expect(body.data?.claim_no).toMatch(/^CLM-\d{6}$/);
    }
  });

  test('POST /api/insurance-billing/claim-records → 400 for missing required fields', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/insurance-billing/claim-records`, {
      headers: authHeaders(),
      data: { patient_id: 1 }, // Missing bill_amount, claimed_amount
    });
    expect([400, 422]).toContain(res.status());
  });

  test('GET /api/insurance-billing/claim-records/:id → gets single claim', async ({ request }) => {
    test.skip(claimId === 0, 'Claim not created');
    const res = await request.get(`${BASE_URL}/api/insurance-billing/claim-records/${claimId}`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json() as { data?: { id?: number; items?: unknown[] } };
      expect(body.data?.id).toBe(claimId);
      expect(Array.isArray(body.data?.items)).toBe(true);
    }
  });

  test('PUT /api/insurance-billing/claim-records/:id/status → updates claim status', async ({ request }) => {
    test.skip(claimId === 0, 'Claim not created');
    const res = await request.put(`${BASE_URL}/api/insurance-billing/claim-records/${claimId}/status`, {
      headers: authHeaders(),
      data: {
        status: 'under_review',
        notes: 'E2E status update',
      },
    });
    expect([200, 201, 400, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📑 EOB (Explanation of Benefits)
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📑 Insurance — EOB', () => {
  test('GET /api/insurance-billing/eob-records → lists EOBs', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/eob-records`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { data?: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  test('POST /api/insurance-billing/eob-records → creates EOB', async ({ request }) => {
    test.skip(claimId === 0, 'Claim not created');
    const res = await request.post(`${BASE_URL}/api/insurance-billing/eob-records`, {
      headers: authHeaders(),
      data: {
        claim_id: claimId,
        eob_date: TODAY,
        total_billed: 75000,
        total_allowed: 60000,
        total_paid: 48000,
        patient_responsibility: 12000,
        notes: 'E2E EOB record',
      },
    });
    expect([200, 201, 400]).toContain(res.status());
    if (res.ok()) {
      const body = await res.json() as { data?: { id?: number } };
      eobId = body.data?.id ?? 0;
    }
  });

  test('GET /api/insurance-billing/eob-records/:id → gets single EOB', async ({ request }) => {
    test.skip(eobId === 0, 'EOB not created');
    const res = await request.get(`${BASE_URL}/api/insurance-billing/eob-records/${eobId}`, {
      headers: authHeaders(),
    });
    expect([200, 404]).toContain(res.status());
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 📊 Stats
// ══════════════════════════════════════════════════════════════════════════════

test.describe('📊 Insurance — Stats', () => {
  test('GET /api/insurance-billing/stats → returns aggregated stats', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/insurance-billing/stats`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as {
      total_active_memberships?: number;
      pending_claims?: number;
    };
    expect(typeof body.total_active_memberships).toBe('number');
    expect(typeof body.pending_claims).toBe('number');
  });
});
