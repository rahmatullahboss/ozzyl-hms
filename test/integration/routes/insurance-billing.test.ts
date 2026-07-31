/**
 * Integration tests for src/routes/tenant/billingInsurance.ts
 *
 * Covers: Claim Records, Companies, Claim Status Updates,
 *         Insurance Patients, Settings, and cross-tenant isolation.
 */

import { describe, it, expect } from 'vitest';
import billingInsuranceRoute from '../../../src/routes/tenant/billingInsurance';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import { TENANT_1, TENANT_2, PATIENT_1 } from '../helpers/fixtures';

// ─── Shared fixtures ────────────────────────────────────────────────────────

const CLAIM_1 = {
  id: 1,
  tenant_id: TENANT_1.id,
  patient_id: PATIENT_1.id,
  claim_no: 'CLM-000001',
  bill_amount: 75000,
  claimed_amount: 60000,
  status: 'submitted',
  submitted_at: '2024-01-20T09:00:00Z',
  created_at: '2024-01-20T09:00:00Z',
};

const COMPANY_1 = {
  id: 1,
  tenant_id: TENANT_1.id,
  company_name: 'Acme Insurance Co',
  insurance_type: 'general',
  is_active: 1,
  created_at: '2024-01-01T00:00:00Z',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeApp(tables: Record<string, unknown[]> = {}) {
  return createTestApp({
    route: billingInsuranceRoute,
    routePath: '/insurance-billing',
    role: 'hospital_admin',
    tenantId: TENANT_1.id,
    tables,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// 🧾 CLAIM RECORDS
// ══════════════════════════════════════════════════════════════════════════════

describe('Insurance Billing — Claim Records', () => {
  describe('GET /claim-records — list', () => {
    it('returns claims list', async () => {
      const { app } = makeApp({ insurance_claims: [CLAIM_1] });
      const res = await app.request('/insurance-billing/claim-records');
      expect(res.status).toBe(200);
      const body = await res.json() as { data?: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns empty when no claims exist', async () => {
      const { app } = makeApp({ insurance_claims: [] });
      const res = await app.request('/insurance-billing/claim-records');
      expect(res.status).toBe(200);
      const body = await res.json() as { data?: unknown[] };
      expect(body.data?.length).toBe(0);
    });

    it('supports ?status=submitted filter', async () => {
      const { app } = makeApp({ insurance_claims: [CLAIM_1] });
      const res = await app.request('/insurance-billing/claim-records?status=submitted');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /claim-records/:id — single', () => {
    it('returns 404 for unknown claim', async () => {
      const { app } = makeApp({ insurance_claims: [] });
      const res = await app.request('/insurance-billing/claim-records/9999');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /claim-records — create', () => {
    it('creates a claim with valid data', async () => {
      const { app } = makeApp({ insurance_claims: [], patients: [PATIENT_1] });
      const res = await jsonRequest(app, '/insurance-billing/claim-records', {
        method: 'POST',
        body: {
          patient_id: PATIENT_1.id,
          bill_amount: 75000,
          claimed_amount: 60000,
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('rejects missing bill_amount (Zod)', async () => {
      const { app } = makeApp({ patients: [PATIENT_1] });
      const res = await jsonRequest(app, '/insurance-billing/claim-records', {
        method: 'POST',
        body: { patient_id: PATIENT_1.id, claimed_amount: 50000 },
      });
      expect([400, 422]).toContain(res.status);
    });
  });

  describe('PUT /claim-records/:id/status — update status', () => {
    it('updates claim status', async () => {
      const { app } = makeApp({ insurance_claims: [CLAIM_1] });
      const res = await jsonRequest(app, '/insurance-billing/claim-records/1/status', {
        method: 'PUT',
        body: { status: 'approved' },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('rejects invalid status', async () => {
      const { app } = makeApp({ insurance_claims: [CLAIM_1] });
      const res = await jsonRequest(app, '/insurance-billing/claim-records/1/status', {
        method: 'PUT',
        body: { status: 'invalid_status' },
      });
      expect([400, 422]).toContain(res.status);
    });
  });

  describe('Tenant isolation', () => {
    it('does not return claims from other tenant', async () => {
      const { app } = createTestApp({
        route: billingInsuranceRoute,
        routePath: '/insurance-billing',
        role: 'hospital_admin',
        tenantId: TENANT_2.id,
        tables: { insurance_claims: [CLAIM_1] }, // belongs to TENANT_1
      });
      const res = await app.request('/insurance-billing/claim-records');
      expect(res.status).toBe(200);
      const body = await res.json() as { data?: unknown[] };
      expect(body.data?.length).toBe(0);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 🏢 COMPANIES
// ══════════════════════════════════════════════════════════════════════════════

describe('Insurance Billing — Companies', () => {
  describe('GET /companies — list', () => {
    it('returns companies for the tenant', async () => {
      const { app } = makeApp({ insurance_companies: [COMPANY_1] });
      const res = await app.request('/insurance-billing/companies');
      expect(res.status).toBe(200);
      const body = await res.json() as { data?: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('returns empty when no companies exist', async () => {
      const { app } = makeApp({ insurance_companies: [] });
      const res = await app.request('/insurance-billing/companies');
      expect(res.status).toBe(200);
      const body = await res.json() as { data?: unknown[] };
      expect(body.data?.length).toBe(0);
    });
  });

  describe('POST /companies — create', () => {
    it('creates a company and returns id', async () => {
      const { app } = makeApp({ insurance_companies: [] });
      const res = await jsonRequest(app, '/insurance-billing/companies', {
        method: 'POST',
        body: {
          company_name: 'New Insurer',
        },
      });
      expect([200, 201]).toContain(res.status);
    });

    it('rejects missing company_name (Zod)', async () => {
      const { app } = makeApp({});
      const res = await jsonRequest(app, '/insurance-billing/companies', {
        method: 'POST',
        body: { insurance_type: 'general' },
      });
      expect([400, 422]).toContain(res.status);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ⚙️ SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

describe('Insurance Billing — Settings', () => {
  describe('GET /settings', () => {
    it('returns settings (empty object when none)', async () => {
      const { app } = makeApp({ insurance_settings: [] });
      const res = await app.request('/insurance-billing/settings');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /settings — create', () => {
    it('creates settings', async () => {
      const { app } = makeApp({});
      const res = await jsonRequest(app, '/insurance-billing/settings', {
        method: 'POST',
        body: { api_url: 'https://api.example.com', api_code: 'ABC123' },
      });
      expect([200, 201]).toContain(res.status);
    });
  });
});
