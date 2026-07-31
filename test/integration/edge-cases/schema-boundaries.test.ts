/**
 * Edge-case tests: Schema Boundary Validation
 *
 * Tests Zod schema enforcement at the route level for patients and billing.
 * Validates that invalid payloads are rejected with proper 400 status codes
 * and that edge cases like Unicode names are accepted.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, createTestAppNoRole, jsonRequest } from '../helpers/test-app';
import patientRoutes from '../../../src/routes/tenant/patients';
import billingRoutes from '../../../src/routes/tenant/billing';

// ─── Shared mock tables ──────────────────────────────────────────────────────

const TENANT = 'tenant-1';

const baseTables: Record<string, Record<string, unknown>[]> = {
  patients: [
    { id: 1, name: 'Ali', patient_code: 'P001', gender: 'male', tenant_id: TENANT, mobile: '01712345678' },
  ],
  serials: [
    { id: 1, tenant_id: TENANT, prefix: 'OZ', current_value: 100 },
  ],
  bills: [],
  invoice_items: [],
  billing_service_items: [
    { id: 7001, tenant_id: TENANT, item_name: 'Consultation', service_department_id: 1, price: 500, is_active: 1 },
    { id: 7002, tenant_id: TENANT, item_name: 'Lab Tests', service_department_id: 2, price: 300, is_active: 1 },
  ],
};

// ─── Patient Schema Boundary Tests ───────────────────────────────────────────

describe('Schema Boundaries — Patient Creation', () => {
  function buildPatientApp() {
    return createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: TENANT,
      tables: baseTables,
      universalFallback: true,
    });
  }

  it('lists patients without emitting ORDER BY 0 when no search is provided', async () => {
    const { app, mockDB } = buildPatientApp();

    const res = await app.request('/patients');

    expect(res.status).toBe(200);
    const listQueries = mockDB.queries.filter((q) =>
      q.sql.toLowerCase().includes('from "patients"') ||
      q.sql.toLowerCase().includes('from patients')
    );
    expect(listQueries.length).toBeGreaterThan(0);
    expect(listQueries.some((q) => /\border by\s+0\b/i.test(q.sql))).toBe(false);
  });

  it('rejects empty name with 400', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: '',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345678',
        age: 30,
        gender: 'male',
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects whitespace-only name with 400', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: '   ',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345678',
        age: 30,
        gender: 'male',
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects patient creation without a registration role with 403', async () => {
    const { app } = createTestAppNoRole({
      route: patientRoutes,
      routePath: '/patients',
      tenantId: TENANT,
      tables: baseTables,
      universalFallback: true,
    });

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Unauthorized Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345681',
        age: 30,
        gender: 'male',
      },
    });

    expect(res.status).toBe(403);
  });

  it('rejects missing required fields with 400', async () => {
    const { app } = buildPatientApp();

    // Missing name entirely
    const res1 = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345678',
        age: 30,
        gender: 'male',
      },
    });
    expect(res1.status).toBe(400);

    // Missing mobile — only name is truly required, fatherHusband and address are optional
    const res2 = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        age: 30,
        gender: 'male',
      },
    });
    expect(res2.status).toBe(400);

    const res3 = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        mobile: '01712345680',
        gender: 'male',
        age: 30,
      },
    });
    expect(res3.status).toBe(201);

    const res4 = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        mobile: '01712345681',
        age: 30,
        gender: 'male',
      },
    });
    expect(res4.status).toBe(201);
  });

  it('rejects invalid gender value with 400', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345678',
        age: 30,
        gender: 'invalid_gender',
      },
    });
    // gender is an enum ['male', 'female', 'other'] — invalid values should be rejected
    expect(res.status).toBe(400);
  });

  it('accepts Unicode names (Bengali script)', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'রহমতউল্লাহ জিসান',
        fatherHusband: 'আব্দুল করিম',
        address: 'ঢাকা, বাংলাদেশ',
        mobile: '01712345679',
        age: 30,
        gender: 'male',
      },
    });
    // Schema does not reject Unicode — should pass validation (201 or 200)
    // Even if the mock DB returns an error for the INSERT, the schema itself accepts it
    expect([200, 201]).toContain(res.status);
  });

  it('accepts valid patient with all optional fields', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Complete Patient',
        fatherHusband: 'Father Name',
        address: '123 Full Address St',
        mobile: '01712345680',
        gender: 'male',
        bloodGroup: 'A+',
        age: 30,
        dateOfBirth: '1995-06-15',
        email: 'test@example.com',
      },
    });
    expect([200, 201]).toContain(res.status);
  });

  it('rejects mobile number shorter than 11 digits with 400', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '0171234',  // too short
        age: 30,
        gender: 'male',
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid blood group with 400', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345678',
        age: 30,
        gender: 'male',
        bloodGroup: 'X+',
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid date of birth format with 400', async () => {
    const { app } = buildPatientApp();
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345678',
        age: 30,
        gender: 'male',
        dateOfBirth: '15/06/1995',  // wrong format, should be YYYY-MM-DD
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects future date of birth with 400', async () => {
    const { app } = buildPatientApp();
    const futureDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Future DOB Patient',
        fatherHusband: 'Father Name',
        address: '123 Test St',
        mobile: '01712345682',
        age: 30,
        gender: 'male',
        dateOfBirth: futureDate,
      },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Billing Schema Boundary Tests ───────────────────────────────────────────

describe('Schema Boundaries — Billing', () => {
  function buildBillingApp() {
    return createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: TENANT,
      tables: baseTables,
      universalFallback: true,
    });
  }

  it('rejects empty items array with 400', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: 1,
        items: [],
        discount: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects negative unit price with 400', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: 1,
        items: [
          {
            itemCategory: 'doctor_visit',
            quantity: 1,
            unitPrice: -500,
            description: 'Invalid negative price',
          },
        ],
        discount: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing patientId with 400', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        items: [
          {
            itemCategory: 'doctor_visit',
            quantity: 1,
            unitPrice: 500,
          },
        ],
        discount: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects invalid item category with 400', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: 1,
        items: [
          {
            itemCategory: 'nonexistent_category',
            quantity: 1,
            unitPrice: 500,
          },
        ],
        discount: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects zero quantity with 400', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: 1,
        items: [
          {
            itemCategory: 'test',
            quantity: 0,
            unitPrice: 500,
          },
        ],
        discount: 0,
      },
    });
    expect(res.status).toBe(400);
  });

  it('rejects negative discount with 400', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: 1,
        items: [
          {
            itemCategory: 'test',
            quantity: 1,
            unitPrice: 500,
          },
        ],
        discount: -100,
      },
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid bill creation', async () => {
    const { app } = buildBillingApp();
    const res = await jsonRequest(app, '/billing', {
      method: 'POST',
      body: {
        patientId: 1,
        items: [
          {
            itemCategory: 'doctor_visit',
            quantity: 1,
            unitPrice: 5,
            description: 'Consultation',
            serviceItemId: 7001,
          },
          {
            itemCategory: 'test',
            quantity: 2,
            unitPrice: 5,
            description: 'Lab Tests',
            serviceItemId: 7002,
          },
        ],
        discount: 100,
        discountReason: 'Test discount',
        discountByName: 'Dr. Smith',
      },
    });
    expect([200, 201]).toContain(res.status);
  });
});
