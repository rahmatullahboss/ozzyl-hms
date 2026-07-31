import { describe, it, expect } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function makeRxMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, tenant_id: 'tenant-1', status: 'draft', patient_id: 1, doctor_id: 1,
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

describe('Prescription Auto-Save', () => {
  // ─── auto-save endpoint works on draft prescriptions ──────────────────────
  it('auto-saves partial data to a draft prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 1 } };
        }
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          if (lower.includes('select id, status, is_locked')) {
            return { first: { id: 1, status: 'draft', is_locked: 0 } };
          }
          return { results: [makeRxMock()], first: makeRxMock() };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/auto-save', {
      method: 'POST',
      body: {
        chiefComplaint: 'Updated complaint',
        diagnosis: 'Updated diagnosis',
        items: [
          { medicine_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS', duration: '5 days' },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(body.timestamp).toBeDefined();
  });

  // ─── auto-save rejects final prescriptions ────────────────────────────────
  it('rejects auto-save on a finalized prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 1 } };
        }
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          if (lower.includes('select id, status, is_locked')) {
            return { first: { id: 1, status: 'final', is_locked: 0 } };
          }
          return { results: [makeRxMock({ status: 'final' })], first: makeRxMock({ status: 'final' }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/auto-save', {
      method: 'POST',
      body: { chiefComplaint: 'Updated complaint' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error || body.message).toMatch(/draft/i);
  });

  // ─── auto-save rejects locked prescriptions ───────────────────────────────
  it('rejects auto-save on a locked prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 1 } };
        }
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          if (lower.includes('select id, status, is_locked')) {
            return { first: { id: 1, status: 'final', is_locked: 1 } };
          }
          return { results: [makeRxMock({ status: 'final', is_locked: 1 })], first: makeRxMock({ status: 'final', is_locked: 1 }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/auto-save', {
      method: 'POST',
      body: { chiefComplaint: 'Updated complaint' },
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error || body.message).toMatch(/draft/i);
  });

  // ─── auto-save updates existing draft with partial data ───────────────────
  it('updates only provided fields on the draft', async () => {
    let updatedFields: Record<string, unknown> = {};

    const mockDB = createMockDB({
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 1 } };
        }
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          if (lower.includes('select id, status, is_locked')) {
            return { first: { id: 1, status: 'draft', is_locked: 0 } };
          }
          return { results: [makeRxMock()], first: makeRxMock() };
        }
        // Track UPDATE statements
        if (lower.includes('update prescriptions') || lower.includes('update "prescriptions"')) {
          updatedFields = { sql, params };
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/auto-save', {
      method: 'POST',
      body: { diagnosis: 'Only diagnosis' },
    });

    expect(res.status).toBe(200);
    // Verify that an UPDATE was executed
    expect(updatedFields.sql).toBeDefined();
    expect(String(updatedFields.sql).toLowerCase()).toContain('update');
  });

  // ─── auto-save returns timestamp ──────────────────────────────────────────
  it('returns server timestamp in response', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 1 } };
        }
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          if (lower.includes('select id, status, is_locked')) {
            return { first: { id: 1, status: 'draft', is_locked: 0 } };
          }
          return { results: [makeRxMock()], first: makeRxMock() };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/auto-save', {
      method: 'POST',
      body: { chiefComplaint: 'Test' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(typeof body.timestamp).toBe('string');
    // Timestamp should be a valid ISO date
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  // ─── auto-save requires doctor role ───────────────────────────────────────
  it('rejects auto-save from non-doctor roles', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock()], first: makeRxMock() };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'reception',
      tenantId: 'tenant-1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/auto-save', {
      method: 'POST',
      body: { chiefComplaint: 'Test' },
    });

    expect(res.status).toBe(403);
  });
});
