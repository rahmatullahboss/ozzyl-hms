import { describe, it, expect } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function makeRxMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, tenant_id: 'tenant-a', status: 'draft', patient_id: 1, doctor_id: 1,
    rx_no: 'RX001', is_locked: 0, locked_at: null, locked_by: null,
    diagnosis: 'Flu', chief_complaint: 'Fever', advice: 'Rest',
    bp: null, temperature: null, weight: null, spo2: null,
    examination_notes: null, lab_tests: null, follow_up_date: null,
    created_by: 1, created_at: '2025-01-01', updated_at: '2025-01-01',
    dispense_status: 'pending', share_token: null, share_expires_at: null,
    delivery_status: 'none', delivery_address: null, delivery_phone: null,
    appointment_id: null,
    ...overrides,
  };
}

function makeRxItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, prescription_id: 1, medicine_name: 'Paracetamol', dosage: '500mg',
    frequency: 'TDS', duration: '5 days', instructions: 'After food',
    sort_order: 0, quantity: 10, dispensed_qty: 0, medicine_id: null,
    ...overrides,
  };
}

function baseQueryOverride(sql: string) {
  const lower = sql.toLowerCase();
  if (lower.includes('from patient_allergies')) return { results: [] };
  if (lower.includes('from patient_active_medications') && lower.includes("status = 'active'")) return { results: [] };
  if (lower.includes('from patient_active_medications') && lower.includes("'discontinued'")) return { results: [] };
  if (lower.includes('from drug_interaction_pairs')) return { results: [] };
  if (lower.includes('from formulary_items')) return { results: [] };
  return null;
}

/**
 * Tenant isolation mock: returns prescription data only when tenant_id in
 * SQL params matches 'tenant-a'. Otherwise returns empty results.
 */
function tenantScopedQueryOverride(sql: string, params: unknown[]) {
  const lower = sql.toLowerCase();
  const base = baseQueryOverride(sql);
  if (base) return base;

  // Prescription SELECT queries — check tenant_id in params
  if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
    const tenantMatch = params.some(p => p === 'tenant-a');
    if (tenantMatch) {
      return { results: [makeRxMock()], first: makeRxMock() };
    }
    return { results: [], first: null };
  }

  // Version queries — scoped to tenant-a prescription
  if (lower.includes('from prescription_versions') || lower.includes('from "prescription_versions"')) {
    const tenantMatch = params.some(p => p === 'tenant-a');
    if (tenantMatch) {
      return {
        results: [
          { id: 1, prescription_id: 1, version_number: 1, snapshot: '{}', edited_by: '1', edit_reason: 'Initial', created_at: '2025-01-01' },
        ],
      };
    }
    return { results: [] };
  }

  // Prescription items
  if (lower.includes('select') && lower.includes('prescription_items')) {
    const tenantMatch = params.some(p => p === 'tenant-a');
    if (tenantMatch) {
      return { results: [makeRxItem()], first: makeRxItem() };
    }
    return { results: [], first: null };
  }

  // INSERT/UPDATE — allow but track
  if (lower.includes('insert into prescription_versions')) {
    return { success: true, meta: { last_row_id: 1 } };
  }
  if (lower.includes('update') && lower.includes('prescriptions') && lower.includes('is_locked')) {
    return { success: true, meta: { changes: 1 } };
  }

  return null;
}

describe('Tenant Isolation', () => {
  it('cannot read another tenant\'s prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: tenantScopedQueryOverride,
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-b',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'GET',
    });

    expect([404, 403]).toContain(res.status);
  });

  it('cannot update another tenant\'s prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: tenantScopedQueryOverride,
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-b',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { diagnosis: 'Hacked' },
    });

    expect([404, 403]).toContain(res.status);
  });

  it('cannot lock another tenant\'s prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: tenantScopedQueryOverride,
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-b',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/lock', {
      method: 'POST',
    });

    expect([404, 403]).toContain(res.status);
  });

  it('cannot view another tenant\'s version history', async () => {
    const mockDB = createMockDB({
      queryOverride: tenantScopedQueryOverride,
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-b',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/versions', {
      method: 'GET',
    });

    // Should either 404 (not found) or return empty versions
    if (res.status === 200) {
      const body = await res.json() as { versions: unknown[] };
      expect(body.versions).toHaveLength(0);
    } else {
      expect([404, 403]).toContain(res.status);
    }
  });

  it('cannot create override for another tenant\'s prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        const base = baseQueryOverride(sql);
        if (base) return base;

        // Prescription lookup — only return for tenant-a
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          const tenantMatch = params.some(p => p === 'tenant-a');
          if (tenantMatch) {
            return { results: [makeRxMock()], first: makeRxMock() };
          }
          return { results: [], first: null };
        }

        // Override inserts — track but allow
        if (lower.includes('insert into prescription_overrides')) {
          return { success: true, meta: { last_row_id: 1 } };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-b',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/overrides', {
      method: 'POST',
      body: { reason: 'Test override' },
    });

    expect([404, 403]).toContain(res.status);
  });
});
