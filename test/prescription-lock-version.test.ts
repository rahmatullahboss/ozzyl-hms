import { describe, it, expect } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

function makeRxMock(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, tenant_id: 't1', status: 'draft', patient_id: 1, doctor_id: 1,
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
  if (lower.includes('from doctors') && lower.includes('user_id')) return { first: { id: 1 } };
  if (lower.includes('from patient_allergies')) return { results: [] };
  if (lower.includes('from patient_active_medications') && lower.includes("status = 'active'")) return { results: [] };
  if (lower.includes('from patient_active_medications') && lower.includes("'discontinued'")) return { results: [] };
  if (lower.includes('from drug_interaction_pairs')) return { results: [] };
  if (lower.includes('from formulary_items')) return { results: [] };
  return null;
}

describe('Prescription Lock + Version History', () => {
  it('creates a version snapshot when prescription is saved as final', async () => {
    let versionInsertCount = 0;
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        const base = baseQueryOverride(sql);
        if (base) return base;
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock()], first: makeRxMock() };
        }
        if (lower.includes('insert into prescription_versions')) {
          versionInsertCount++;
          return { success: true, meta: { last_row_id: 1 } };
        }
        if (lower.includes('insert or ignore into patient_active_medications')) {
          return { success: true, meta: { last_row_id: 1 } };
        }
        if (lower.includes('select') && lower.includes('prescription_items')) {
          return { results: [makeRxItem()], first: makeRxItem() };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { status: 'final' },
    });

    expect(res.status).toBe(200);
    expect(versionInsertCount).toBeGreaterThan(0);
  });

  it('rejects direct mutation of a finalized prescription even when an edit reason is supplied', async () => {
    let versionInserts = 0;
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        const base = baseQueryOverride(sql);
        if (base) return base;
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final' })], first: makeRxMock({ status: 'final' }) };
        }
        if (lower.includes('insert into prescription_versions')) {
          versionInserts++;
          return { success: true, meta: { last_row_id: versionInserts } };
        }
        if (lower.includes('select') && lower.includes('prescription_items')) {
          return { results: [makeRxItem()], first: makeRxItem() };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { diagnosis: 'Updated', edit_reason: 'Patient condition changed' },
    });

    expect(res.status).toBe(409);
    expect(versionInserts).toBe(0);
  });

  it('rejects direct dispensing mutation on the finalized clinical prescription record', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final', is_locked: 1 })], first: makeRxMock({ status: 'final', is_locked: 1 }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'pharmacist',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { dispense_status: 'dispensed' },
    });

    expect(res.status).toBe(400);
    const sql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(sql).not.toContain('update "prescriptions"');
  });

  it('does not allow pharmacy dispensing access to mutate finalized clinical content', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final' })], first: makeRxMock({ status: 'final' }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'pharmacist',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { dispense_status: 'dispensed', diagnosis: 'Changed in dispensary' },
    });

    expect(res.status).toBe(400);
  });

  it('retires new medicine delivery requests stored directly on a prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final' })], first: makeRxMock({ status: 'final' }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/order-delivery', {
      method: 'POST',
      body: { address: 'Dhaka address', phone: '01700000000' },
    });

    expect(res.status).toBe(410);
    expect(mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n')).not.toContain('delivery_status');
  });

  it('retires legacy delivery status mutations stored directly on a prescription', async () => {
    const mockDB = createMockDB();
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'pharmacist',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/delivery-status', {
      method: 'PUT',
      body: { status: 'dispatched' },
    });

    expect(res.status).toBe(410);
    expect(mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n')).not.toContain('delivery_status');
  });

  it('rejects update of final prescription without edit_reason', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        const base = baseQueryOverride(sql);
        if (base) return base;
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final' })], first: makeRxMock({ status: 'final' }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { diagnosis: 'Updated' },
    });

    expect([400, 409]).toContain(res.status);
  });

  it('locks a prescription setting is_locked=1', async () => {
    let lockUpdate = false;
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctors') && lower.includes('user_id')) {
          return { first: { id: 1 } };
        }
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final', is_locked: 0 })], first: makeRxMock({ status: 'final', is_locked: 0 }) };
        }
        if (lower.includes('update') && lower.includes('prescriptions') && lower.includes('is_locked')) {
          lockUpdate = true;
          return { success: true, meta: { changes: 1 } };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/lock', {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    expect(lockUpdate).toBe(true);
  });

  it('returns 403 when editing a locked prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final', is_locked: 1 })], first: makeRxMock({ status: 'final', is_locked: 1 }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { diagnosis: 'Updated' },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/locked/i);
  });

  it('returns version history in order', async () => {
    const mockDB = createMockDB({
	      queryOverride: (sql) => {
	        const lower = sql.toLowerCase();
	        if (lower.includes('from doctors') && lower.includes('user_id')) return { first: { id: 1 } };
	        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
	          return { results: [makeRxMock()], first: makeRxMock() };
        }
        if (lower.includes('from prescription_versions') || lower.includes('from "prescription_versions"')) {
          return {
            results: [
              { id: 1, prescription_id: 1, version_number: 1, snapshot: '{}', edited_by: '1', edit_reason: 'Initial', created_at: '2025-01-01' },
              { id: 2, prescription_id: 1, version_number: 2, snapshot: '{}', edited_by: '1', edit_reason: 'Update', created_at: '2025-01-02' },
            ],
          };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/versions', {
      method: 'GET',
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { versions: Array<{ version_number: number }> };
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version_number).toBe(1);
    expect(body.versions[1].version_number).toBe(2);
  });

  it('cannot unlock a locked prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final', is_locked: 1 })], first: makeRxMock({ status: 'final', is_locked: 1 }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { is_locked: 0 },
    });

    expect([400, 403, 409]).toContain(res.status);
  });

  it('lock endpoint rejects already-locked prescription', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock({ status: 'final', is_locked: 1 })], first: makeRxMock({ status: 'final', is_locked: 1 }) };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1/lock', {
      method: 'POST',
    });

    expect([409, 403]).toContain(res.status);
  });

  it('version snapshot contains correct prescription data', async () => {
    let snapshotData: string | null = null;
    const mockDB = createMockDB({
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        const base = baseQueryOverride(sql);
        if (base) return base;
        if ((lower.includes('from prescriptions') || lower.includes('from "prescriptions"')) && lower.includes('where')) {
          return { results: [makeRxMock()], first: makeRxMock() };
        }
        if (lower.includes('insert into prescription_versions')) {
          snapshotData = params[1] as string;
          return { success: true, meta: { last_row_id: 1 } };
        }
        if (lower.includes('insert or ignore into patient_active_medications')) {
          return { success: true, meta: { last_row_id: 1 } };
        }
        if (lower.includes('select') && lower.includes('prescription_items')) {
          return { results: [makeRxItem()], first: makeRxItem() };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/prescriptions',
      role: 'doctor',
      tenantId: 't1',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/1', {
      method: 'PUT',
      body: { status: 'final', diagnosis: 'Typhoid', chiefComplaint: 'Fever' },
    });

    expect(res.status).toBe(200);
    expect(snapshotData).not.toBeNull();
    const snapshot = JSON.parse(snapshotData!);
    expect(snapshot.diagnosis).toBe('Typhoid');
    expect(snapshot.chiefComplaint).toBe('Fever');
  });
});
