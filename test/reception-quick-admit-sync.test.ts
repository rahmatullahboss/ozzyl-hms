import { describe, expect, it } from 'vitest';
import receptionRoutes from '../src/routes/tenant/reception';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('reception quick-admit local-sync coverage', () => {
  it('commits patient, patient outbox, and emergency visit in one D1 batch', async () => {
    const { app, mockDB } = createTestApp({
      route: receptionRoutes,
      routePath: '/reception',
      role: 'reception',
      tenantId: 'tenant-1',
      queryOverride(sql, params) {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.startsWith('insert into sequence_counters')) {
          const value = params[0] === 'unknown_patient' ? 12 : 34;
          return {
            first: { current_value: value },
            results: [{ current_value: value }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, patient_code, name, mobile, age, gender') && normalized.includes('from patients')) {
          return {
            first: {
              id: 77,
              patient_code: 'UKN-000012',
              name: 'Unknown Emergency',
              mobile: '',
              age: null,
              gender: 'other',
            },
            results: [],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      extraEnv: {
        ENVIRONMENT: 'local_server',
        LOCAL_SERVER_ID: 'hospital-lan-primary',
      },
    });

    const response = await jsonRequest(app, '/reception/quick-admit', {
      method: 'POST',
      body: { reason: 'Unidentified emergency arrival' },
    });

    expect(response.status).toBe(201);
    const atomicBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /INSERT\s+INTO\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql))
      && batch.some((sql) => /INSERT\s+INTO\s+visits/i.test(sql)),
    );
    expect(atomicBatch).toBeDefined();

    const patientInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInsert?.params).toContain('UKN-000012');
    expect(patientInsert?.params).toContain('Unknown Emergency UKN-000012');
  });
});
