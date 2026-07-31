import { describe, expect, it } from 'vitest';
import patientRoutes from '../src/routes/tenant/patients';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const mpi = {
  id: 77,
  uhid: 'OZ-LINK-0001',
  primary_name: 'Linked Patient',
  primary_phone: '+8801739416661',
  primary_email: 'linked@example.test',
  national_id: null,
  blood_group: 'A+',
  date_of_birth: '2000-01-01',
  gender: 'male',
};

function makeApp(options: { reusablePatient?: boolean; failSecondStageOnce?: boolean } = {}) {
  let durablePatientExists = Boolean(options.reusablePatient);
  let durablePatientId = options.reusablePatient ? 44 : 91;
  const mockDB = createMockDB({
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.startsWith('insert into sequence_counters')) {
        return {
          first: { current_value: 51 },
          results: [{ current_value: 51 }],
          success: true,
          meta: {},
        };
      }
      if (normalized.includes('from patient_health_links') && normalized.includes('is_active = 1')) {
        return { first: null, results: [], success: true, meta: {} };
      }
      if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
        return { first: mpi, results: [mpi], success: true, meta: {} };
      }
      if (normalized.includes('select name from tenants')) {
        return {
          first: { name: 'Test Hospital' },
          results: [{ name: 'Test Hospital' }],
          success: true,
          meta: {},
        };
      }
      if (normalized.includes('select id, name, father_husband, address, mobile, patient_code')
        && normalized.includes('from patients')) {
        const patient = durablePatientExists
          ? {
              id: durablePatientId,
              name: 'Linked Patient',
              father_husband: '',
              address: 'Dhaka',
              mobile: '01739416661',
              patient_code: durablePatientId === 44 ? 'P-000044' : 'P-000051',
            }
          : null;
        return {
          first: patient,
          results: patient ? [patient] : [],
          success: true,
          meta: {},
        };
      }
      if (normalized.startsWith('insert into patients')) {
        return {
          results: [],
          success: true,
          meta: { last_row_id: 91, changes: 1 },
        };
      }
      if (normalized.includes('select id, name, mobile, patient_code from patients')) {
        const id = durablePatientId;
        return {
          first: { id, name: 'Linked Patient', mobile: '01739416661', patient_code: id === 44 ? 'P-000044' : 'P-000051' },
          results: [],
          success: true,
          meta: {},
        };
      }
      return null;
    },
  });

  if (options.failSecondStageOnce) {
    const mutableDb = mockDB.db as unknown as {
      batch: (statements: D1PreparedStatement[]) => Promise<Array<{ meta?: { last_row_id?: number } }>>;
    };
    const originalBatch = mutableDb.batch.bind(mutableDb);
    let batchCall = 0;
    let failed = false;
    mutableDb.batch = async (statements) => {
      batchCall += 1;
      if (batchCall === 2 && !failed) {
        failed = true;
        throw new Error('simulated link-stage failure');
      }
      const results = await originalBatch(statements);
      if (batchCall === 1) {
        durablePatientExists = true;
        durablePatientId = Number(results[0]?.meta?.last_row_id ?? 91);
      }
      return results;
    };
  }

  const { app } = createTestApp({
    route: patientRoutes,
    routePath: '/patients',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    mockDB,
    extraEnv: {
      ENVIRONMENT: 'local_server',
      LOCAL_SERVER_ID: 'hospital-lan-primary',
    },
  });

  return { app, mockDB };
}

describe('patient link-global local-server durability', () => {
  it('atomically updates a reusable patient, health link, and all related outbox events', async () => {
    const { app, mockDB } = makeApp({ reusablePatient: true });

    const response = await jsonRequest(app, '/patients/link-global', {
      method: 'POST',
      body: { uhid: mpi.uhid },
    });

    expect(response.status).toBe(200);
    const atomicBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /UPDATE\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(sql))
      && batch.filter((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)).length === 3,
    );
    expect(atomicBatch).toBeDefined();
  });

  it('uses a recoverable two-stage flow for a new patient: patient/outbox first, then link/outboxes', async () => {
    const { app, mockDB } = makeApp();

    const response = await jsonRequest(app, '/patients/link-global', {
      method: 'POST',
      body: { uhid: mpi.uhid },
    });

    expect(response.status).toBe(200);
    const patientBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /INSERT\s+INTO\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)),
    );
    expect(patientBatch).toBeDefined();

    const linkBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(sql))
      && batch.filter((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)).length === 2,
    );
    expect(linkBatch).toBeDefined();

    const patientInsert = mockDB.queries.find((query) => /^\s*INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInsert?.params[6]).toBeNull();
    expect(patientInsert?.params).toContain('OZ-LINK-0001');
  });

  it('heals a failed second-stage link on retry without inserting a duplicate patient', async () => {
    const { app, mockDB } = makeApp({ failSecondStageOnce: true });

    const firstResponse = await jsonRequest(app, '/patients/link-global', {
      method: 'POST',
      body: { uhid: mpi.uhid },
    });
    expect(firstResponse.status).toBe(500);

    const retryResponse = await jsonRequest(app, '/patients/link-global', {
      method: 'POST',
      body: { uhid: mpi.uhid },
    });
    expect(retryResponse.status).toBe(200);

    const patientInserts = mockDB.queries.filter((query) => /^\s*INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInserts).toHaveLength(1);
    expect(mockDB.batchCalls.some((batch) =>
      batch.some((sql) => /UPDATE\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(sql)),
    )).toBe(true);
  });
});
