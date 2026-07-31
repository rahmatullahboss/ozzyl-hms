import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';

// ─── Lab Test Request from Prescription ──────────────────────────────────────
// Feature: Create lab orders from prescription's lab_tests field
// Endpoint: POST /api/prescriptions/:id/create-lab-order
//
// TDD RED: These tests validate the route handler logic.

describe('Lab Test Request from Prescription — POST /api/prescriptions/:id/create-lab-order', () => {

  it('should return 404 for non-existent prescription', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/999/create-lab-order', {
      method: 'POST',
    });

    expect(res.status).toBe(404);
  });

  it('should return 400 when prescription has no lab_tests', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, lab_tests: null, status: 'final', tenant_id: 'tenant-1' },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/create-lab-order', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('No lab tests');
  });

  it('should create lab order from prescription lab_tests', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, lab_tests: '["CBC","Blood Sugar","Urine R/E"]', status: 'final', tenant_id: 'tenant-1' },
        ],
        lab_orders: [],
        lab_order_items: [],
        lab_test_catalog: [
          { id: 1, name: 'CBC', price: 500, tenant_id: 'tenant-1', is_active: 1 },
          { id: 2, name: 'Blood Sugar', price: 200, tenant_id: 'tenant-1', is_active: 1 },
          { id: 3, name: 'Urine R/E', price: 300, tenant_id: 'tenant-1', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/create-lab-order', {
      method: 'POST',
    });

    // Should succeed (201) or at least not fail with 404/500
    expect([200, 201]).toContain(res.status);

    const body = await res.json() as { orderId?: number; orderNo?: string; message?: string };
    expect(body.orderId || body.message).toBeDefined();
  });

  it('inserts lab order with required order_date', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, lab_tests: '["CBC"]', status: 'final', tenant_id: 'tenant-1' },
        ],
        lab_orders: [],
        lab_order_items: [],
        lab_test_catalog: [
          { id: 1, name: 'CBC', price: 500, tenant_id: 'tenant-1', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/create-lab-order', {
      method: 'POST',
    });

    expect(res.status).toBe(201);
    const orderInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+lab_orders/i.test(query.sql));
    expect(orderInsert?.sql).toContain('order_date');
  });

  it('stores the entered-by user separately from the prescription doctor', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 44, lab_tests: '["CBC"]', status: 'final', tenant_id: 'tenant-1' },
        ],
        doctors: [
          { id: 44, tenant_id: 'tenant-1', user_id: 7001, is_active: 1 },
        ],
        lab_orders: [],
        lab_order_items: [],
        lab_test_catalog: [
          { id: 1, name: 'CBC', price: 500, tenant_id: 'tenant-1', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'hospital_admin',
      userId: 77,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/create-lab-order', {
      method: 'POST',
    });

    expect(res.status).toBe(201);
    const orderInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+lab_orders/i.test(query.sql));
    expect(orderInsert?.sql).toContain('ordering_clinician_doctor_id');
    expect(Number(orderInsert?.params[2])).toBe(77);
    expect(Number(orderInsert?.params[3])).toBe(44);
  });

  it('links prescription-origin lab orders back to the prescription and snapshots item prices', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, lab_tests: '["CBC"]', status: 'final', tenant_id: 'tenant-1' },
        ],
        lab_orders: [],
        lab_order_items: [],
        lab_test_catalog: [
          { id: 1, name: 'CBC', price: 500, tenant_id: 'tenant-1', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/create-lab-order', {
      method: 'POST',
    });

    expect(res.status).toBe(201);
    const orderInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+lab_orders/i.test(query.sql));
    expect(orderInsert?.sql).toContain('prescription_id');
    expect(orderInsert?.params).toContain(1);

    const itemInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+lab_order_items/i.test(query.sql));
    expect(itemInsert?.sql).toContain('unit_price');
    expect(itemInsert?.sql).toContain('line_total');
    expect(itemInsert?.params).toContain(500);
  });

  it('rejects unmapped lab tests before creating an order', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, lab_tests: '["CBC","Unknown Test"]', status: 'final', tenant_id: 'tenant-1' },
        ],
        lab_orders: [],
        lab_order_items: [],
        lab_test_catalog: [
          { id: 1, name: 'CBC', price: 500, tenant_id: 'tenant-1', is_active: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/create-lab-order', {
      method: 'POST',
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain('Unknown Test');
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+lab_orders/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+lab_order_items/i.test(query.sql))).toBe(false);
  });
});
