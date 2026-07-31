import { describe, expect, test } from 'vitest';
import predictiveRoutes from '../src/routes/tenant/predictiveAnalytics';
import cdsRoutes from '../src/routes/tenant/clinicalDecisionSupport';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

// Simple mock data - ONLY what we need
const PATIENT = { id: 1, tenant_id: 'tenant-1', date_of_birth: '1980-01-01', weight: 70, kidney_function: 'normal', liver_function: 'normal' };

describe('Predictive Analytics API', () => {
  test('GET /predictive/patient-risk/:patientId - 404 for invalid patient', async () => {
    const mockDB = createMockDB({
      tables: {
        patients: [PATIENT], // Only patient 1 exists
      },
      universalFallback: false,
    });
    const { app } = createTestApp({
      route: predictiveRoutes,
      routePath: '/predictive',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 10,
      mockDB,
    });

    // Patient 999 does NOT exist - should 404
    const res = await jsonRequest(app, '/predictive/patient-risk/999');
    expect(res.status).toBe(404);
  });

  test('GET /predictive/sepsis-risk/:patientId - returns data for valid patient', async () => {
    const mockDB = createMockDB({
      tables: {
        patients: [PATIENT],
        vitals: [{ id: 1, patient_id: 1, tenant_id: 'tenant-1', vital_type: 'temperature', value: '38.5' }],
      },
      universalFallback: false,
    });
    const { app } = createTestApp({
      route: predictiveRoutes,
      routePath: '/predictive',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 10,
      mockDB,
    });

    const res = await jsonRequest(app, '/predictive/sepsis-risk/1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sepsisScore');
  });
});

describe('Clinical Decision Support API', () => {
  test('POST /cds/drug-interaction-check - detects interaction', async () => {
    const { app } = createTestApp({
      route: cdsRoutes,
      routePath: '/cds',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 10,
      mockDB: createMockDB({ universalFallback: false }),
    });

    const res = await jsonRequest(app, '/cds/drug-interaction-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medications: ['warfarin', 'aspirin'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.interactions.length).toBeGreaterThan(0);
  });

  test('POST /cds/allergy-check - detects allergy', async () => {
    const mockDB = createMockDB({
      tables: {
        patients: [PATIENT],
        allergies: [{ id: 1, patient_id: 1, tenant_id: 'tenant-1', allergen: 'Penicillin', reaction: 'Rash' }],
      },
      universalFallback: false,
    });
    const { app } = createTestApp({
      route: cdsRoutes,
      routePath: '/cds',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 10,
      mockDB,
    });

    const res = await jsonRequest(app, '/cds/allergy-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId: 1, medications: ['Penicillin'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('alerts');
  });

  test('GET /cds/clinical-alerts/:patientId - 404 for invalid patient', async () => {
    const mockDB = createMockDB({
      tables: {
        patients: [PATIENT], // Only patient 1 exists
      },
      universalFallback: false,
    });
    const { app } = createTestApp({
      route: cdsRoutes,
      routePath: '/cds',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 10,
      mockDB,
    });

    // Patient 999 does NOT exist - should 404
    const res = await jsonRequest(app, '/cds/clinical-alerts/999');
    expect(res.status).toBe(404);
  });
});
