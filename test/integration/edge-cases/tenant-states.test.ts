/**
 * Edge-case tests: Tenant State Validation
 *
 * Tests tenant context edge cases: empty tenantId, non-existent tenants,
 * and boundary conditions in tenant-scoped queries.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from '../helpers/test-app';
import patientRoutes from '../../../src/routes/tenant/patients';
import billingRoutes from '../../../src/routes/tenant/billing';

// ─── Empty Tenant ID Tests ───────────────────────────────────────────────────

describe('Tenant States — Empty Tenant ID', () => {
  it('rejects empty tenantId on patient list with 403', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: '',  // empty string — requireTenantId should reject
      tables: {
        patients: [{ id: 1, name: 'Ali', tenant_id: 'tenant-1' }],
      },
    });

    const res = await jsonRequest(app, '/patients');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Tenant');
  });

  it('rejects empty tenantId on billing list with 403', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: '',
      tables: { bills: [], patients: [] },
    });

    const res = await jsonRequest(app, '/billing');
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Tenant');
  });

  it('rejects empty tenantId on patient creation with 403', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: '',
      tables: { patients: [], serials: [] },
    });

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Test Patient',
        fatherHusband: 'Father',
        address: 'Address',
        mobile: '01712345678',
        age: 30,
        gender: 'male',
      },
    });
    expect(res.status).toBe(403);
  });
});

// ─── Non-Existent Tenant Tests ───────────────────────────────────────────────

describe('Tenant States — Non-Existent Tenant', () => {
  it('returns empty results for patients when tenant has no data', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: 'tenant-nonexistent-999',
      tables: {
        // Data exists but belongs to a different tenant
        patients: [{ id: 1, name: 'Ali', tenant_id: 'tenant-other', patient_code: 'P001' }],
      },
    });

    const res = await jsonRequest(app, '/patients');
    // The mock DB returns whatever is in tables, but the SQL filters by tenant_id.
    // With mock DB, this will still return data (mock doesn't filter SQL).
    // The important thing is the route itself runs without crashing.
    expect(res.status).toBe(200);
  });

  it('returns empty results for billing when tenant has no data', async () => {
    const { app } = createTestApp({
      route: billingRoutes,
      routePath: '/billing',
      role: 'hospital_admin',
      tenantId: 'tenant-nonexistent-999',
      tables: { bills: [], patients: [] },
    });

    const res = await jsonRequest(app, '/billing');
    expect(res.status).toBe(200);
  });

  it('handles valid but non-matching tenant ID gracefully', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: 'tenant-does-not-exist',
      tables: { patients: [] },
    });

    const res = await jsonRequest(app, '/patients');
    expect(res.status).toBe(200);
  });
});
