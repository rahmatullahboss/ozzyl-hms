import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';

// ─── Prescription History API ────────────────────────────────────────────────
// Feature: Lightweight prescription history for patient in Rx editor sidebar
// Endpoint: GET /api/prescriptions/history?patientId=X
//
// TDD RED: These tests validate the route handler logic.

describe('Prescription History API — GET /api/prescriptions/history', () => {

  it('should return 400 when patientId is missing', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/history');
    // Should return 400 because patientId is required
    expect(res.status).toBe(400);
  });

  it('should return prescription history when patientId is provided', async () => {
    const mockDB = createMockDB({
      universalFallback: true,
      tables: {
        prescriptions: [
          { id: 1, rx_no: 'RX-000001', patient_id: 1, doctor_id: 1, created_at: '2026-05-15', diagnosis: 'URI', chief_complaint: 'Fever', advice: 'Rest', follow_up_date: '2026-05-22', status: 'final' },
          { id: 2, rx_no: 'RX-000002', patient_id: 1, doctor_id: 1, created_at: '2026-05-10', diagnosis: 'Gastritis', chief_complaint: 'Stomach pain', advice: 'Avoid spicy food', follow_up_date: null, status: 'final' },
        ],
      },
    });
    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/history?patientId=1');
    // Should return 200 with prescriptions array
    expect(res.status).toBe(200);
    const body = await res.json() as { prescriptions: unknown[] };
    expect(body.prescriptions).toBeDefined();
  });
});
