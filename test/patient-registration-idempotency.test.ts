import { describe, expect, test } from 'vitest';
import patientRoutes from '../src/routes/tenant/patients';
import { createIdempotencyRequestHash } from '../src/lib/request-idempotency';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const baseBody = {
  name: 'Retry Safe Patient',
  fatherHusband: 'Parent Name',
  address: 'Dhaka',
  mobile: '01712345678',
  gender: 'male' as const,
  age: 30,
  uhid: 'OZ-000123',
  idempotencyKey: 'patient-attempt-123',
};

function identityRow() {
  return {
    id: 7,
    uhid: 'OZ-000123',
    claim_status: 'unclaimed',
    claimed_auth_user_id: null,
    created_source: 'hospital',
  };
}

function patientInsertResult() {
  return {
    results: [{ id: 51 }],
    success: true,
    meta: { last_row_id: 51 },
  };
}

describe('patient registration idempotency', () => {
  test('replays a completed registration without inserting another patient', async () => {
    const replayBody = {
      message: 'Patient registered',
      patientId: 77,
      patientCode: 'P-000077',
      uhid: 'OZ-000123',
      serial: '20260726-007',
    };
    const requestHash = await createIdempotencyRequestHash({ ...baseBody, idempotencyKey: undefined });
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'completed',
              source_id: '77',
              response_json: JSON.stringify(replayBody),
            },
          };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return { results: [identityRow()] };
        }
        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return patientInsertResult();
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      mockDB,
    });

    const response = await jsonRequest(app, '/patients', { method: 'POST', body: baseBody });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ...replayBody, idempotent: true });
    expect(mockDB.queries.some((query) => /insert\s+into\s+"?patients"?/i.test(query.sql))).toBe(false);
  });

  test('rejects reuse of a registration key with a different payload', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: 'different-request-hash',
              status: 'failed',
              source_id: null,
              response_json: null,
            },
          };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return { results: [identityRow()] };
        }
        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return patientInsertResult();
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      mockDB,
    });

    const response = await jsonRequest(app, '/patients', { method: 'POST', body: baseBody });

    expect(response.status).toBe(409);
    expect(mockDB.queries.some((query) => /insert\s+into\s+"?patients"?/i.test(query.sql))).toBe(false);
  });

  test('recovers a durable patient created before an interrupted response', async () => {
    const requestHash = await createIdempotencyRequestHash({ ...baseBody, idempotencyKey: undefined });
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'pending',
              source_id: null,
              response_json: null,
            },
          };
        }
        if (normalized.includes('registration_idempotency_key')) {
          return {
            first: {
              id: 88,
              patient_code: 'P-000088',
              uhid: 'OZ-000123',
            },
          };
        }
        if (normalized.includes('from serials') && normalized.includes('patient_id = ?')) {
          return { first: { serial_number: '20260726-008' } };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return { results: [identityRow()] };
        }
        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return patientInsertResult();
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      mockDB,
    });

    const response = await jsonRequest(app, '/patients', { method: 'POST', body: baseBody });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body.patientId).toBe(88);
    expect(body.serial).toBe('20260726-008');
    expect(mockDB.queries.some((query) => /insert\s+into\s+"?patients"?/i.test(query.sql))).toBe(false);
    expect(mockDB.queries.some((query) => query.sql.includes("SET status = 'completed'"))).toBe(true);
  });

  test('stores the durable key and completes the replay record on first success', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return { first: null };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return { results: [identityRow()] };
        }
        if (normalized.includes('from serials') && normalized.includes('patient_id = ?')) {
          return { first: { serial_number: '20260726-051' } };
        }
        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return patientInsertResult();
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      mockDB,
    });

    const response = await jsonRequest(app, '/patients', { method: 'POST', body: baseBody });

    expect(response.status).toBe(201);
    const patientInsert = mockDB.queries.find((query) => /insert\s+into\s+"?patients"?/i.test(query.sql));
    expect(patientInsert?.params).toContain(baseBody.idempotencyKey);
    expect(mockDB.queries.some((query) => query.sql.includes("SET status = 'completed'"))).toBe(true);
  });
});
