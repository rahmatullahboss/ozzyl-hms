import { describe, expect, it } from 'vitest';
import referralRoutes from '../src/routes/tenant/referrals';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const referral = {
  id: 10,
  from_tenant_id: 'sender-tenant',
  to_tenant_id: 'receiver-tenant',
  patient_global_id: 'UHID-REF-001',
  status: 'pending',
};

function createReferralApp(options: {
  existingPatientId?: number;
  identity?: Record<string, unknown> | null;
  failHealthLinkOutboxOnce?: boolean;
} = {}) {
  let referralStatus = referral.status;
  let linkedPatientId = options.existingPatientId;
  let shouldFailHealthLinkOutbox = Boolean(options.failHealthLinkOutboxOnce);
  return createTestApp({
    route: referralRoutes,
    routePath: '/referrals',
    role: 'hospital_admin',
    tenantId: 'receiver-tenant',
    queryOverride(sql, params) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('select * from cross_hospital_referrals where id = ?')) {
        const currentReferral = { ...referral, status: referralStatus };
        return { first: currentReferral, results: [currentReferral], success: true, meta: {} };
      }
      if (normalized.includes('from patient_health_links') && normalized.includes('uhid = ?')) {
        const row = linkedPatientId ? {
          patient_id: linkedPatientId,
          national_id: 'NID-501',
          hospital_name: 'Receiver Hospital',
        } : null;
        return { first: row, results: row ? [row] : [], success: true, meta: {} };
      }
      if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
        const identity = options.identity === undefined
          ? {
              id: 501,
              uhid: 'UHID-REF-001',
              primary_name: 'Referred Patient',
              primary_phone: '01700000501',
              primary_email: 'referred@example.test',
              national_id: 'NID-501',
              blood_group: 'B+',
              date_of_birth: '1995-01-02',
              gender: 'female',
            }
          : options.identity;
        return { first: identity, results: identity ? [identity] : [], success: true, meta: {} };
      }
      if (normalized.startsWith('insert into sequence_counters')) {
        return {
          first: { current_value: 91 },
          results: [{ current_value: 91 }],
          success: true,
          meta: {},
        };
      }
      if (normalized.includes('select name from tenants')) {
        return {
          first: { name: 'Receiver Hospital' },
          results: [{ name: 'Receiver Hospital' }],
          success: true,
          meta: {},
        };
      }
      if (normalized.includes('select id from patients') && normalized.includes('patient_code = ?')) {
        return {
          first: { id: 91 },
          results: [{ id: 91 }],
          success: true,
          meta: {},
        };
      }
      if (normalized.startsWith('update cross_hospital_referrals set status = ?')) {
        referralStatus = String(params[0]);
      }
      if (normalized.startsWith('insert or ignore into patient_health_links')) {
        linkedPatientId = 91;
      }
      if (
        normalized.startsWith('insert or ignore into local_sync_outbox')
        && params[1] === 'patient_health_links'
        && shouldFailHealthLinkOutbox
      ) {
        shouldFailHealthLinkOutbox = false;
        throw new Error('simulated referral health-link outbox failure');
      }
      return null;
    },
    extraEnv: {
      ENVIRONMENT: 'local_server',
      LOCAL_SERVER_ID: 'receiver-lan',
    },
  });
}

describe('referral acceptance patient linkage', () => {
  it('atomically accepts the referral, creates the patient/outbox, and writes the current health-link schema', async () => {
    const { app, mockDB } = createReferralApp();

    const response = await jsonRequest(app, '/referrals/10/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });

    expect(response.status).toBe(200);
    const acceptanceBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /INSERT\s+INTO\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(sql))
      && batch.some((sql) => /UPDATE\s+cross_hospital_referrals/i.test(sql)),
    );
    expect(acceptanceBatch).toBeDefined();

    const patientInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInsert?.sql).toMatch(/father_husband/i);
    expect(patientInsert?.sql).toMatch(/patient_code/i);
    expect(patientInsert?.params).toContain('P-000091');

    const linkInsert = mockDB.queries.find((query) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(query.sql));
    expect(linkInsert?.sql).toMatch(/national_id/i);
    expect(linkInsert?.sql).toMatch(/patient_id/i);
    expect(linkInsert?.sql).toMatch(/uhid/i);
    expect(linkInsert?.sql).not.toMatch(/global_patient_id|local_patient_id/i);

    const healthLinkOutbox = mockDB.queries.find((query) =>
      /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(query.sql)
      && query.params[1] === 'patient_health_links',
    );
    expect(healthLinkOutbox?.params[2]).toBe('receiver-tenant:91:UHID-REF-001');
    expect(JSON.parse(String(healthLinkOutbox?.params[5]))).toMatchObject({
      tenant_id: 'receiver-tenant',
      patient_id: 91,
      uhid: 'UHID-REF-001',
      national_id: 'NID-501',
      hospital_name: 'Receiver Hospital',
    });
  });

  it('does not mislabel a UHID as the patient national ID when the identity has no NID', async () => {
    const { app, mockDB } = createReferralApp({
      identity: {
        id: 502,
        uhid: 'UHID-REF-001',
        primary_name: 'No NID Patient',
        primary_phone: '01700000502',
        primary_email: null,
        national_id: null,
        blood_group: null,
        date_of_birth: null,
        gender: null,
      },
    });

    const response = await jsonRequest(app, '/referrals/10/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });

    expect(response.status).toBe(200);
    const patientInsert = mockDB.queries.find((query) => /INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInsert?.params[6]).toBeNull();
    expect(patientInsert?.params[11]).toBe('UHID-REF-001');

    const linkInsert = mockDB.queries.find((query) => /INSERT\s+OR\s+IGNORE\s+INTO\s+patient_health_links/i.test(query.sql));
    expect(linkInsert?.params[0]).toBe('UHID-REF-001');
  });

  it('accepts with an existing health link without creating another patient and emits the missing health-link outbox', async () => {
    const { app, mockDB } = createReferralApp({ existingPatientId: 88 });

    const response = await jsonRequest(app, '/referrals/10/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });

    expect(response.status).toBe(200);
    expect(mockDB.queries.some((query) => /INSERT\s+INTO\s+patients/i.test(query.sql))).toBe(false);
    const updateBatch = mockDB.batchCalls.find((batch) =>
      batch.filter((sql) => /UPDATE\s+cross_hospital_referrals/i.test(sql)).length >= 1
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)),
    );
    expect(updateBatch).toBeDefined();
    const healthLinkOutbox = mockDB.queries.find((query) =>
      /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(query.sql)
      && query.params[1] === 'patient_health_links',
    );
    expect(JSON.parse(String(healthLinkOutbox?.params[5]))).toMatchObject({
      tenant_id: 'receiver-tenant',
      patient_id: 88,
      uhid: 'UHID-REF-001',
    });
  });

  it('repairs a failed health-link outbox on idempotent accept retry without creating a duplicate patient', async () => {
    const { app, mockDB } = createReferralApp({ failHealthLinkOutboxOnce: true });

    const firstResponse = await jsonRequest(app, '/referrals/10/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });
    expect(firstResponse.status).toBe(500);

    const retryResponse = await jsonRequest(app, '/referrals/10/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });
    expect(retryResponse.status).toBe(200);

    const patientInserts = mockDB.queries.filter((query) => /INSERT\s+INTO\s+patients/i.test(query.sql));
    expect(patientInserts).toHaveLength(1);
    const healthLinkOutboxes = mockDB.queries.filter((query) =>
      /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(query.sql)
      && query.params[1] === 'patient_health_links',
    );
    expect(healthLinkOutboxes).toHaveLength(1);
    expect(JSON.parse(String(healthLinkOutboxes[0]?.params[5]))).toMatchObject({
      tenant_id: 'receiver-tenant',
      patient_id: 91,
      uhid: 'UHID-REF-001',
    });
    const repairBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /UPDATE\s+cross_hospital_referrals/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)),
    );
    expect(repairBatch).toBeDefined();
  });

  it('does not mark a referral accepted when the global patient identity is missing', async () => {
    const { app, mockDB } = createReferralApp({ identity: null });

    const response = await jsonRequest(app, '/referrals/10/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });

    expect(response.status).toBe(409);
    expect(mockDB.queries.some((query) => /UPDATE\s+cross_hospital_referrals/i.test(query.sql))).toBe(false);
    expect(mockDB.batchCalls).toHaveLength(0);
  });
});
