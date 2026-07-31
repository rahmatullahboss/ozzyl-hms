import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';

// ─── Repeat Prescription API ─────────────────────────────────────────────────
// Feature: Copy previous prescription for returning patients
// Endpoint: GET /api/prescriptions/:id/repeat
//
// TDD RED: These tests validate the route handler logic.

describe('Repeat Prescription API', () => {

  it('should return 404 for non-existent prescription', async () => {
    const mockDB = createMockDB({ universalFallback: false });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/999/repeat');
    expect(res.status).toBe(404);
  });

  it('should return repeat data with prescription fields and items', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, diagnosis: 'URI', chief_complaint: 'Fever', advice: 'Rest', follow_up_date: '2026-05-22', status: 'final', tenant_id: 'tenant-1' },
        ],
        prescription_items: [
          { id: 1, prescription_id: 1, medicine_name: 'Paracetamol 500mg', dosage: '500mg', frequency: '1+1+1', duration: '5 days', instructions: 'After Food', sort_order: 0 },
          { id: 2, prescription_id: 1, medicine_name: 'Amoxicillin 500mg', dosage: '500mg', frequency: '1+0+1', duration: '7 days', instructions: 'After Food', sort_order: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/repeat');
    expect(res.status).toBe(200);

    const body = await res.json() as {
      prescription: {
        id: number;
        diagnosis: string | null;
        chief_complaint: string | null;
        advice: string | null;
      };
      items: { medicine_name: string; dosage: string | null; frequency: string | null }[];
    };

    expect(body.prescription).toBeDefined();
    expect(body.prescription.diagnosis).toBeDefined();
    expect(body.items).toBeDefined();
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('should return items sorted by sort_order', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, diagnosis: 'Test', status: 'final', tenant_id: 'tenant-1' },
        ],
        prescription_items: [
          { id: 1, prescription_id: 1, medicine_name: 'Med A', sort_order: 0 },
          { id: 2, prescription_id: 1, medicine_name: 'Med B', sort_order: 1 },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/1/repeat');
    expect(res.status).toBe(200);

    const body = await res.json() as { items: { medicine_name: string }[] };
    // Items should be sorted by sort_order (Med A first, Med B second)
    expect(body.items[0].medicine_name).toBe('Med A');
    expect(body.items[1].medicine_name).toBe('Med B');
  });
});
