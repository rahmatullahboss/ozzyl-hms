import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import prescriptionRoutes from '../src/routes/tenant/prescriptions';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('prescription usage stats', () => {
  it('updates doctor-specific medicine and lab usage when a prescription is finalized', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('insert into sequence_counters')) {
          return { first: { current_value: 1 }, success: true, meta: {} };
        }
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 1 }, success: true, meta: {} };
        }
        if (normalized.includes('from doctors') && normalized.includes('is_active')) {
          return { first: { id: 1 }, success: true, meta: {} };
        }
        if (normalized.includes('from patients')) {
          return { first: { id: 10 }, results: [{ id: 10 }], success: true, meta: {} };
        }
        if (normalized.includes('from patient_active_medications')) {
          return { results: [], success: true, meta: {} };
        }
        if (normalized.includes('from patient_allergies')) {
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
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 11,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions', {
      method: 'POST',
      body: {
        patientId: 10,
        doctorId: 1,
        status: 'final',
        labTests: ['CBC', 'LFT'],
        items: [
          {
            medicine_name: 'Napa',
            dosage: '500mg',
            frequency: '1+1+1',
            duration: '5 days',
            instructions: 'After meal',
          },
        ],
      },
    });

    expect(res.status).toBe(201);
    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('insert into prescription_medicine_usage_stats')
      && query.params.includes('Napa')
      && query.params.includes(1),
    )).toBe(true);
    expect(mockDB.queries.filter((query) =>
      query.sql.toLowerCase().includes('insert into prescription_lab_test_usage_stats'),
    )).toHaveLength(2);
  });

  it('does not let a doctor read another doctor frequent lab tests by query param', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from doctors') && normalized.includes('user_id')) {
          return { first: { id: 1 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: prescriptionRoutes,
      routePath: '/api/prescriptions',
      role: 'doctor',
      tenantId: 'tenant-1',
      userId: 11,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/prescriptions/frequent-lab-tests?doctorId=2');

    expect(res.status).toBe(403);
  });

  it('backfills doctor-specific lab quick picks from existing finalized prescriptions', () => {
    const migration = readFileSync('migrations/0339_backfill_prescription_lab_test_usage_stats.sql', 'utf8');

    expect(migration).toContain('prescription_lab_test_usage_stats');
    expect(migration).toContain('json_each(p.lab_tests)');
    expect(migration).toContain('p.doctor_id IS NOT NULL');
    expect(migration).toContain("p.status IN ('final', 'dispensed', 'completed')");
  });
});
