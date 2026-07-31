import { describe, it, expect } from 'vitest';
import prescriptionsRoute from '../src/routes/tenant/prescriptions';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';

describe('Prescription allergy safety', () => {
  it('blocks amoxicillin when patient has severe penicillin allergy', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        if (sql.toLowerCase().includes('from patient_allergies')) {
          return {
            results: [{
              id: 1,
              patient_id: 1,
              tenant_id: 'tenant-1',
              allergy_type: 'drug',
              allergen: 'Penicillin',
              severity: 'severe',
              is_active: 1,
            }],
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const { app } = createTestApp({
      route: prescriptionsRoute,
      routePath: '/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions', {
      method: 'POST',
      body: {
        patientId: 1,
        doctorId: 1,
        items: [{ medicine_name: 'Amoxicillin 500mg', dosage: '500mg' }],
      },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Prescription blocked');
    expect(body.error).toContain('Penicillin');
  });

  it('blocks prescription update when replacement items conflict with severe allergy', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patient_allergies')) {
          return {
            results: [
              {
                id: 1,
                patient_id: 1,
                tenant_id: 'tenant-1',
                allergy_type: 'drug',
                allergen: 'Penicillin',
                severity: 'life_threatening',
                is_active: 1,
              },
            ],
          };
        }

        if (lower.includes('from "prescriptions"') || lower.includes('from prescriptions')) {
          return {
            results: [{ status: 'draft', patientId: 1, doctorId: 1 }],
            first: { status: 'draft', patientId: 1, doctorId: 1 },
          };
        }

        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: prescriptionsRoute,
      routePath: '/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/9', {
      method: 'PUT',
      body: {
        items: [{ medicine_name: 'Cloxacillin', dosage: '500mg' }],
      },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Prescription blocked');
    expect(body.error).toContain('Penicillin');
  });

  it('blocks direct edits to finalized prescriptions', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from "prescriptions"') || lower.includes('from prescriptions')) {
          return {
            results: [{ status: 'final', patientId: 1, doctorId: 1 }],
            first: { status: 'final', patientId: 1, doctorId: 1 },
          };
        }

        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: prescriptionsRoute,
      routePath: '/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/9', {
      method: 'PUT',
      body: {
        diagnosis: 'Updated diagnosis',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Finalized prescriptions cannot be edited directly');
  });

  it('allows re-saving a draft prescription without treating draft as an invalid transition', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from "prescriptions"') || lower.includes('from prescriptions')) {
          return {
            results: [{ status: 'draft', patientId: 1, doctorId: 1 }],
            first: { status: 'draft', patientId: 1, doctorId: 1 },
          };
        }

        return null;
      },
      universalFallback: true,
    });

    const { app } = createTestApp({
      route: prescriptionsRoute,
      routePath: '/prescriptions',
      role: 'doctor',
      mockDB,
    });

    const res = await jsonRequest(app, '/prescriptions/9', {
      method: 'PUT',
      body: {
        diagnosis: 'Updated draft diagnosis',
        status: 'draft',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });
});
