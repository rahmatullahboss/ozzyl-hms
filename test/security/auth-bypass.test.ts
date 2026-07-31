/**
 * Security Tests — Authentication & Authorization Bypass
 *
 * 1. Cross-tenant isolation: user from tenant-1 must NOT see tenant-2 patient data.
 * 2. Role escalation: a receptionist must NOT access admin-only endpoints (permissions).
 * 3. No-role context: requests with no role set must NOT return sensitive data.
 */

import { describe, it, expect } from 'vitest';
import { createTestApp, createTestAppNoRole, jsonRequest } from '../integration/helpers/test-app';
import patientRoutes from '../../src/routes/tenant/patients';
import permissionRoutes from '../../src/routes/tenant/permissions';
import auditRoutes from '../../src/routes/tenant/audit';
import billingCancellationRoutes from '../../src/routes/tenant/billingCancellation';
import creditNotesRoutes from '../../src/routes/tenant/creditNotes';
import depositsRoutes from '../../src/routes/tenant/deposits';
import settlementsRoutes from '../../src/routes/tenant/settlements';

// ─── Cross-Tenant Isolation ─────────────────────────────────────────────────

describe('Cross-Tenant Isolation', () => {
  const TENANT_1_PATIENTS = [
    { id: 1, tenant_id: 'tenant-1', name: 'Alice', mobile: '01700000001', address: 'Dhaka', father_husband: 'Father1' },
    { id: 2, tenant_id: 'tenant-1', name: 'Bob', mobile: '01700000002', address: 'Dhaka', father_husband: 'Father2' },
  ];

  const TENANT_2_PATIENTS = [
    { id: 3, tenant_id: 'tenant-2', name: 'Charlie', mobile: '01700000003', address: 'Chittagong', father_husband: 'Father3' },
  ];

  it('tenant-1 user cannot see tenant-2 patient data in list', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        patients: [...TENANT_1_PATIENTS, ...TENANT_2_PATIENTS],
      },
    });

    const res = await app.request('/patients', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { patients: Array<{ id: number; tenant_id: string; name: string }> };
    // Must only contain tenant-1 patients
    for (const patient of body.patients) {
      expect(patient.tenant_id).toBe('tenant-1');
    }
    // Must NOT contain any tenant-2 patient
    const tenant2Names = TENANT_2_PATIENTS.map((p) => p.name);
    for (const patient of body.patients) {
      expect(tenant2Names).not.toContain(patient.name);
    }
  });

  it('tenant-1 user gets 404 when requesting tenant-2 patient by ID', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      tables: {
        patients: [...TENANT_1_PATIENTS, ...TENANT_2_PATIENTS],
      },
    });

    // Patient id=3 belongs to tenant-2
    const res = await app.request('/patients/3', { method: 'GET' });
    // Should be 404 because tenant_id filter excludes it
    expect(res.status).toBe(404);
  });

  it('tenant-2 user cannot see tenant-1 patients', async () => {
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      tenantId: 'tenant-2',
      tables: {
        patients: [...TENANT_1_PATIENTS, ...TENANT_2_PATIENTS],
      },
    });

    const res = await app.request('/patients', { method: 'GET' });
    expect(res.status).toBe(200);

    const body = await res.json() as { patients: Array<{ tenant_id: string }> };
    for (const patient of body.patients) {
      expect(patient.tenant_id).toBe('tenant-2');
    }
  });
});

// ─── Role Escalation ─────────────────────────────────────────────────────────

describe('Role Escalation — receptionist accessing admin-only endpoint', () => {
  it('receptionist accessing permissions catalog gets 403', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'reception',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/catalog', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('nurse accessing permissions matrix gets 403', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'nurse',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/matrix', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('doctor accessing permissions role update gets 403', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'doctor',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/permissions/role', {
      method: 'PUT',
      body: { role: 'nurse', permissions: ['patients:read'] },
    });
    expect(res.status).toBe(403);
  });

  it('hospital_admin CAN access permissions catalog (positive control)', async () => {
    const { app } = createTestApp({
      route: permissionRoutes,
      routePath: '/permissions',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/catalog', { method: 'GET' });
    expect(res.status).toBe(200);
  });

  it('receptionist cannot read audit logs', async () => {
    const { app } = createTestApp({
      route: auditRoutes as any,
      routePath: '/audit',
      role: 'reception',
      tenantId: 'tenant-1',
      tables: { audit_logs: [] },
    });

    const res = await app.request('/audit/logs', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('receptionist cannot cancel bills', async () => {
    const { app } = createTestApp({
      route: billingCancellationRoutes,
      routePath: '/billing-cancellation',
      role: 'reception',
      tenantId: 'tenant-1',
      tables: { bills: [] },
    });

    const res = await jsonRequest(app, '/billing-cancellation', {
      method: 'POST',
      body: { bill_id: 1, reason: 'Wrong bill' },
    });
    expect(res.status).toBe(403);
  });

  it('receptionist cannot process deposit refunds', async () => {
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'reception',
      tenantId: 'tenant-1',
      tables: { patients: [{ id: 1, tenant_id: 'tenant-1' }] },
    });

    const res = await jsonRequest(app, '/deposits/refund', {
      method: 'POST',
      body: { patient_id: 1, amount: 100 },
    });
    expect(res.status).toBe(403);
  });

  it('receptionist cannot issue credit-note refunds', async () => {
    const { app } = createTestApp({
      route: creditNotesRoutes,
      routePath: '/credit-notes',
      role: 'reception',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/credit-notes', {
      method: 'POST',
      body: {
        bill_id: 1,
        patient_id: 1,
        reason: 'Unauthorized refund attempt',
        items: [{ invoice_item_id: 1, return_quantity: 1 }],
      },
    });
    expect(res.status).toBe(403);
  });

  it('doctor cannot create patient settlements', async () => {
    const { app } = createTestApp({
      route: settlementsRoutes,
      routePath: '/settlements',
      role: 'doctor',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/settlements', {
      method: 'POST',
      body: { patient_id: 1, bill_ids: [1], paid_amount: 100 },
    });
    expect(res.status).toBe(403);
  });

  it('receptionist cannot apply settlement discounts without finance approval', async () => {
    const { app } = createTestApp({
      route: settlementsRoutes,
      routePath: '/settlements',
      role: 'reception',
      tenantId: 'tenant-1',
    });

    const res = await jsonRequest(app, '/settlements', {
      method: 'POST',
      body: {
        patient_id: 1,
        bill_ids: [1],
        paid_amount: 0,
        deposit_deducted: 0,
        discount_amount: 100,
      },
    });
    expect(res.status).toBe(403);
  });

  it('doctor cannot directly collect patient deposits', async () => {
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'doctor',
      tenantId: 'tenant-1',
      tables: { patients: [{ id: 1, tenant_id: 'tenant-1' }] },
    });

    const res = await jsonRequest(app, '/deposits', {
      method: 'POST',
      body: { patient_id: 1, amount: 100 },
    });
    expect(res.status).toBe(403);
  });

  it('doctor cannot directly adjust patient deposits against bills', async () => {
    const { app } = createTestApp({
      route: depositsRoutes,
      routePath: '/deposits',
      role: 'doctor',
      tenantId: 'tenant-1',
      tables: {
        patients: [{ id: 1, tenant_id: 'tenant-1' }],
        bills: [{ id: 9, tenant_id: 'tenant-1', patient_id: 1, total: 500, paid: 0 }],
      },
    });

    const res = await jsonRequest(app, '/deposits/adjust', {
      method: 'POST',
      body: { patient_id: 1, bill_id: 9, amount: 100 },
    });
    expect(res.status).toBe(403);
  });
});

// ─── No-Role Context ─────────────────────────────────────────────────────────

describe('No-Role Context — request with no role set', () => {
  it('no-role user accessing permissions endpoint gets 403', async () => {
    const { app } = createTestAppNoRole({
      route: permissionRoutes,
      routePath: '/permissions',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/catalog', { method: 'GET' });
    expect(res.status).toBe(403);
  });

  it('no-role response body does not expose internal permission details', async () => {
    const { app } = createTestAppNoRole({
      route: permissionRoutes,
      routePath: '/permissions',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/permissions/catalog', { method: 'GET' });
    const body = await res.json() as Record<string, unknown>;
    // Should not expose internal data structures
    expect(body).not.toHaveProperty('all_permissions');
    expect(body).not.toHaveProperty('groups');
    expect(body).not.toHaveProperty('matrix');
  });
});
