import { describe, expect, it } from 'vitest';
import prescriptionsRoute from '../src/routes/tenant/prescriptions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('Prescription drug interaction safety', () => {
  it('blocks prescription creation when new medication conflicts with an active medication through a major interaction', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patient_allergies')) {
          return { results: [], success: true, meta: {} };
        }

        if (normalized.includes('from patient_active_medications')) {
          if (normalized.includes("status in ('discontinued', 'completed', 'on_hold', 'suspended')")) {
            return {
              results: [{
                medication_name: 'Phenelzine',
                generic_name: 'phenelzine',
                status: 'discontinued',
                stop_date: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
              }],
              success: true,
              meta: {},
            };
          }

          return {
            results: [{ medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active' }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from drug_interaction_pairs')) {
          return {
            results: [{
              drug_a_name: 'warfarin',
              drug_b_name: 'ibuprofen',
              severity: 'major',
              description: 'Bleeding risk',
              recommendation: 'Avoid combination',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from formulary_items')) {
          return { results: [], success: true, meta: {} };
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
        items: [{ medicine_name: 'Ibuprofen', dosage: '400mg' }],
      },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('Interaction');
    expect(body.error).toContain('Warfarin');
  });

  it('blocks prescription creation when a recently discontinued medication is still inside its washout window', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patient_allergies')) {
          return { results: [], success: true, meta: {} };
        }

        if (normalized.includes('from patient_active_medications')) {
          if (normalized.includes("status in ('discontinued', 'completed', 'on_hold', 'suspended')")) {
            return {
              results: [{
                medication_name: 'Phenelzine',
                generic_name: 'phenelzine',
                status: 'discontinued',
                stop_date: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
              }],
              success: true,
              meta: {},
            };
          }

          return { results: [], success: true, meta: {} };
        }

        if (normalized.includes('from drug_interaction_pairs')) {
          return { results: [], success: true, meta: {} };
        }

        if (normalized.includes('from formulary_items')) {
          return { results: [], success: true, meta: {} };
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
        items: [{ medicine_name: 'Sertraline', dosage: '50mg' }],
      },
    });

    expect(res.status).toBe(422);
    const body = await res.json() as { error: string };
    expect(body.error.toLowerCase()).toContain('washout');
    expect(body.error).toContain('Phenelzine');
  });
});
