import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { calculateAgeFromDateOfBirth } from '../src/lib/patient-age';
import { createIdempotencyRequestHash } from '../src/lib/request-idempotency';
import patientRoutes from '../src/routes/tenant/patients';
import { createPatientSchema } from '../src/schemas/patient';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function findQuery(
  queries: Array<{ sql: string; params: unknown[]; method: string }>,
  pattern: string,
) {
  return queries.find((query) => query.sql.toLowerCase().includes(pattern.toLowerCase()));
}

describe('tenant patient registration global identity linking', () => {
  test('calculates age from date of birth using completed years', () => {
    expect(calculateAgeFromDateOfBirth('1990-05-20', new Date('2026-05-02T00:00:00Z'))).toBe(35);
    expect(calculateAgeFromDateOfBirth('1990-04-20', new Date('2026-05-02T00:00:00Z'))).toBe(36);
  });

  test('patient schema normalizes Bangladesh mobile input before persistence', () => {
    const parsed = createPatientSchema.parse({
      name: 'Rahim Uddin',
      fatherHusband: 'Karim Uddin',
      address: 'Dhaka',
      mobile: '+880 1712-345678',
      guardianMobile: '8801812345678',
      emergencyContactPhone: '01912 345 678',
      gender: 'male',
      age: 30,
    });

    expect(parsed.mobile).toBe('01712345678');
    expect(parsed.guardianMobile).toBe('01812345678');
    expect(parsed.emergencyContactPhone).toBe('01912345678');
  });

  test('patient schema rejects invalid Bangladesh mobile numbers', () => {
    expect(createPatientSchema.safeParse({
      name: 'Bad Phone',
      fatherHusband: 'Unknown',
      address: 'Dhaka',
      mobile: '12345678901',
      gender: 'male',
    }).success).toBe(false);

    expect(createPatientSchema.safeParse({
      name: 'Bad Operator',
      fatherHusband: 'Unknown',
      address: 'Dhaka',
      mobile: '01212345678',
      gender: 'male',
    }).success).toBe(false);
  });

  test('POST /patients links to existing global identity by UHID', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('insert into sequence_counters')) {
          return {
            first: { current_value: 1 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return {
            results: [{ id: 1 }],
            success: true,
            meta: { last_row_id: 1 },
          };
        }

        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return {
            results: [{
              id: 7,
              uhid: 'OZ-000123',
              claim_status: 'claimed',
              claimed_auth_user_id: null,
              created_source: 'self_signup',
            }],
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'Rahim Uddin',
        fatherHusband: 'Karim Uddin',
        address: 'Dhaka',
        mobile: '01712345678',
        gender: 'male',
        age: 30,
        uhid: 'OZ-000123',
      },
    });

    expect(res.status).toBe(201);

    const patientUpdate = findQuery(mockDB.queries, 'update patients');
    expect(patientUpdate?.params).toContain(7);
    expect(patientUpdate?.params).toContain('OZ-000123');
  });

  test('POST /patients creates unclaimed global identity when none exists', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('insert into sequence_counters')) {
          return {
            first: { current_value: 1 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return {
            results: [{ id: 1 }],
            success: true,
            meta: { last_row_id: 1 },
          };
        }

        if (normalized.includes('update uhid_sequence set')) {
          return {
            first: { last_value: 321 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into global_patient_identity')) {
          return {
            success: true,
            meta: { last_row_id: 55 },
          };
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

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'New Patient',
        fatherHusband: 'Unknown',
        address: 'Khulna',
        mobile: '01812345678',
        gender: 'female',
        age: 30,
        email: 'new.patient@example.com',
        idempotencyKey: 'patient-create-new-identity-001',
      },
    });

    expect(res.status).toBe(201);

    const identityInsert = findQuery(mockDB.queries, 'insert into global_patient_identity');
    expect(identityInsert?.params).toContain('unclaimed');
    expect(identityInsert?.params).toContain('hospital');

    const patientUpdate = findQuery(mockDB.queries, 'update patients');
    expect(patientUpdate?.params).toContain(55);
    expect(patientUpdate?.params.some((param) => typeof param === 'string' && /^OZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(param))).toBe(true);

    const idempotencyCompletion = findQuery(mockDB.queries, 'update billing_mutation_idempotency_keys');
    expect(idempotencyCompletion?.params).toContain('patient_registration_create');
    expect(idempotencyCompletion?.params).toContain('patient-create-new-identity-001');
  });

  test('POST /patients stores calculated age when DOB is provided without age', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('insert into sequence_counters')) {
          return {
            first: { current_value: 1 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return {
            results: [{ id: 1 }],
            success: true,
            meta: { last_row_id: 1 },
          };
        }

        if (normalized.includes('update uhid_sequence set')) {
          return {
            first: { last_value: 321 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into global_patient_identity')) {
          return {
            success: true,
            meta: { last_row_id: 55 },
          };
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

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'DOB Patient',
        fatherHusband: 'Unknown',
        address: 'Dhaka',
        mobile: '01712345678',
        gender: 'female',
        dateOfBirth: '1990-01-01',
      },
    });

    expect(res.status).toBe(201);
    const patientInsert = findQuery(mockDB.queries, 'insert into "patients"');
    expect(patientInsert?.params).toContain(calculateAgeFromDateOfBirth('1990-01-01'));
  });

  test('PUT /patients/:id persists DOB, email, and recalculated age', async () => {
    const existingPatient = {
      id: 1,
      patient_code: 'P-000001',
      uhid: null,
      name: 'Existing Patient',
      father_husband: 'Existing Father',
      address: 'Dhaka',
      mobile: '01712345678',
      guardian_mobile: null,
      age: 30,
      gender: 'male',
      blood_group: null,
      email: null,
      date_of_birth: null,
      is_duplicate: 0,
      duplicate_of_patient_id: null,
      verified_mobile: 0,
      tenant_id: 'tenant-1',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from "patients"') || normalized.includes('from patients')) {
          return {
            results: [existingPatient],
            first: existingPatient,
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientRoutes,
      routePath: '/patients',
      role: 'hospital_admin',
      mockDB,
      extraEnv: {
        ENVIRONMENT: 'local_server',
        LOCAL_SERVER_ID: 'hospital-lan-primary',
      },
    });

    const res = await jsonRequest(app, '/patients/1', {
      method: 'PUT',
      body: {
        dateOfBirth: '1988-02-10',
        email: 'updated.patient@example.com',
      },
    });

    expect(res.status).toBe(200);
    const update = findQuery(mockDB.queries, 'update patients');
    expect(update?.params).toContain('1988-02-10');
    expect(update?.params).toContain('updated.patient@example.com');
    expect(update?.params).toContain(calculateAgeFromDateOfBirth('1988-02-10'));
    const atomicBatch = mockDB.batchCalls.find((batch) =>
      batch.some((sql) => /UPDATE\s+patients/i.test(sql))
      && batch.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+local_sync_outbox/i.test(sql)),
    );
    expect(atomicBatch).toBeDefined();
  });

  test('POST /patients warns instead of creating when weak duplicate evidence exists', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patients') && normalized.includes('mobile = ?')) {
          return {
            results: [{
              id: 41,
              patient_code: 'P-000041',
              uhid: 'OZ-000041',
              name: 'Existing Patient',
              mobile: '01812345678',
              date_of_birth: '1990-01-01',
              gender: 'male',
            }],
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'New Patient',
        fatherHusband: 'Unknown',
        address: 'Khulna',
        mobile: '01812345678',
        gender: 'male',
        age: 30,
        idempotencyKey: 'duplicate-warning-attempt-1',
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string; possibleDuplicates: unknown[] };
    expect(body.code).toBe('POSSIBLE_DUPLICATE_PATIENT');
    expect(body.possibleDuplicates.length).toBeGreaterThan(0);
    expect(findQuery(mockDB.queries, 'insert into global_patient_identity')).toBeUndefined();
    expect(findQuery(mockDB.queries, 'insert into "patients"')).toBeUndefined();
    expect(findQuery(mockDB.queries, 'insert or ignore into billing_mutation_idempotency_keys')).toBeUndefined();
    expect(findQuery(mockDB.queries, 'update billing_mutation_idempotency_keys')).toBeUndefined();
  });

  test('POST /patients replays a completed registration idempotency key without creating another patient', async () => {
    const requestBody = {
      name: 'Nuruzzaman',
      fatherHusband: 'Unknown',
      address: 'Dhaka',
      mobile: '01717385801',
      gender: 'male' as const,
      age: 78,
      idempotencyKey: 'patient-create-attempt-001',
    };
    const requestHash = await createIdempotencyRequestHash({
      ...requestBody,
      idempotencyKey: undefined,
    });
    const replayBody = {
      message: 'Patient registered',
      patientId: 958,
      patientCode: 'P-000958',
      uhid: 'OZ-SHJY-EPK7',
      serial: '20260720-075',
    };

    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from patients') && normalized.includes('mobile = ?')) {
          return {
            results: [{
              id: 958,
              patient_code: 'P-000958',
              uhid: 'OZ-SHJY-EPK7',
              name: 'Nuruzzaman',
              mobile: '01717385801',
              date_of_birth: '1948-01-01',
              gender: 'male',
            }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert or ignore into billing_mutation_idempotency_keys')) {
          return { success: true, meta: { changes: 0 } };
        }
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'completed',
              response_json: JSON.stringify(replayBody),
            },
            results: [],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert into sequence_counters')) {
          return { first: { current_value: 959 }, success: true, meta: {} };
        }
        if (normalized.includes('insert into "patients"') || normalized.includes('insert into patients')) {
          return {
            results: [{ id: 959 }],
            success: true,
            meta: { last_row_id: 959, changes: 1 },
          };
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

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: requestBody,
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...replayBody, idempotent: true });
    expect(findQuery(mockDB.queries, 'insert into "patients"')).toBeUndefined();
  });

  test('POST /patients recovers a committed patient from a pending idempotency source without creating another patient', async () => {
    const requestBody = {
      name: 'Nuruzzaman',
      fatherHusband: 'Unknown',
      address: 'Dhaka',
      mobile: '01717385801',
      gender: 'male' as const,
      age: 78,
      idempotencyKey: 'patient-create-recovery-001',
    };
    const requestHash = await createIdempotencyRequestHash({
      ...requestBody,
      idempotencyKey: undefined,
    });
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'pending',
              response_json: null,
              source_id: '958',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patients') && normalized.includes('where id = ?') && normalized.includes('tenant_id = ?')) {
          return {
            first: {
              id: 958,
              patient_code: 'P-000958',
              uhid: 'OZ-SHJY-EPK7',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from serials') && normalized.includes('patient_id = ?')) {
          return {
            first: { serial_number: '20260720-075' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('update billing_mutation_idempotency_keys')) {
          return { success: true, meta: { changes: 1 } };
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

    const res = await jsonRequest(app, '/patients', { method: 'POST', body: requestBody });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      message: 'Patient registered',
      patientId: 958,
      patientCode: 'P-000958',
      uhid: 'OZ-SHJY-EPK7',
      serial: '20260720-075',
      idempotent: true,
      recovered: true,
    });
    expect(findQuery(mockDB.queries, 'insert into "patients"')).toBeUndefined();
  });

  test('POST /patients rejects a concurrent replay while the same idempotency key is pending', async () => {
    const requestBody = {
      name: 'Nuruzzaman',
      fatherHusband: 'Unknown',
      address: 'Dhaka',
      mobile: '01717385801',
      gender: 'male' as const,
      age: 78,
      idempotencyKey: 'patient-create-attempt-002',
    };
    const requestHash = await createIdempotencyRequestHash({
      ...requestBody,
      idempotencyKey: undefined,
    });
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('insert or ignore into billing_mutation_idempotency_keys')) {
          return { success: true, meta: { changes: 0 } };
        }
        if (normalized.includes('from billing_mutation_idempotency_keys')) {
          return {
            first: {
              request_hash: requestHash,
              status: 'pending',
              response_json: null,
            },
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients', { method: 'POST', body: requestBody });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'This patient registration is already being processed. Please wait a moment.',
    });
    expect(findQuery(mockDB.queries, 'insert into "patients"')).toBeUndefined();
  });

  test('POST /patients duplicate warning uses normalized mobile number', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (
          normalized.includes('from patients') &&
          normalized.includes('mobile = ?') &&
          params.includes('01812345678')
        ) {
          return {
            results: [{
              id: 41,
              patient_code: 'P-000041',
              uhid: 'OZ-000041',
              name: 'Existing Patient',
              mobile: '01812345678',
              date_of_birth: '1990-01-01',
              gender: 'male',
            }],
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients', {
      method: 'POST',
      body: {
        name: 'New Patient',
        fatherHusband: 'Unknown',
        address: 'Khulna',
        mobile: '+8801812345678',
        gender: 'male',
        age: 30,
      },
    });

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string; possibleDuplicates: Array<{ mobile: string }> };
    expect(body.code).toBe('POSSIBLE_DUPLICATE_PATIENT');
    expect(body.possibleDuplicates[0]?.mobile).toBe('01812345678');
    expect(findQuery(mockDB.queries, 'insert into global_patient_identity')).toBeUndefined();
  });

  test('GET /patients/global-search resolves before /:id and finds phone matches', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from global_patient_identity') && params.includes('01739416661')) {
          return {
            results: [{
              id: 77,
              uhid: 'OZ-01739416661',
              primary_name: 'Zisan',
              primary_phone: '01739416661',
              primary_email: null,
              date_of_birth: null,
              gender: 'male',
              claim_status: 'unclaimed',
              linked_patient_id: null,
            }],
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients/global-search?q=01739416661');

    expect(res.status).toBe(200);
    const body = await res.json() as { results: Array<{ uhid: string; primary_phone: string }> };
    expect(body.results[0]?.uhid).toBe('OZ-01739416661');
    expect(body.results[0]?.primary_phone).toBe('01739416661');
    const globalSearchQuery = mockDB.queries.find((query) => query.sql.toLowerCase().includes('from global_patient_identity gpi'));
    expect(globalSearchQuery?.sql).toContain('gpi.uhid = ?');
    expect(globalSearchQuery?.sql).not.toContain(' OR uhid = ?');
  });

  test('GET /patients normalizes Bangladesh mobile search before matching local patients', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (
          normalized.includes('from "patients"') &&
          normalized.includes('mobile') &&
          params.includes('01739416661')
        ) {
          return {
            results: [{
              id: 88,
              patient_code: 'P-000088',
              uhid: 'OZ-LOCAL-88',
              name: 'Local Zisan',
              father_husband: null,
              address: null,
              mobile: '01739416661',
              guardian_mobile: null,
              email: null,
              age: 26,
              gender: 'male',
              blood_group: null,
              date_of_birth: null,
              tenant_id: 'tenant-1',
              created_at: '2026-05-16 00:00:00',
            }],
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients?search=+8801739416661&limit=8');

    expect(res.status).toBe(200);
    const body = await res.json() as { patients: Array<{ id: number; mobile: string }> };
    expect(body.patients[0]?.id).toBe(88);
    expect(body.patients[0]?.mobile).toBe('01739416661');
  });

  test('POST /patients/link-global creates a local patient using only real patient columns', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('insert into sequence_counters')) {
          return {
            first: { current_value: 1 },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return {
            first: {
              id: 77,
              uhid: 'OZ-01739416661',
              primary_name: 'Zisan',
              primary_phone: '+8801739416661',
              primary_email: null,
              national_id: null,
              blood_group: null,
              date_of_birth: '2000-01-01',
              gender: 'male',
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from tenants')) {
          return {
            first: { name: 'Demo Hospital' },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into patients')) {
          return {
            success: true,
            meta: { last_row_id: 91, changes: 1 },
          };
        }

        if (normalized.includes('select id, name, mobile, patient_code from patients')) {
          return {
            first: {
              id: 91,
              name: 'Zisan',
              mobile: '01739416661',
              patient_code: 'P-000001',
            },
            success: true,
            meta: {},
          };
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

    const res = await jsonRequest(app, '/patients/link-global', {
      method: 'POST',
      body: { uhid: 'OZ-01739416661' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { patientId: number; patient: { mobile: string } };
    expect(body.patientId).toBe(91);
    expect(body.patient.mobile).toBe('01739416661');
    const patientInsert = findQuery(mockDB.queries, 'insert into patients');
    expect(patientInsert?.sql).toContain('father_husband');
    expect(patientInsert?.sql).toContain('address');
    expect(patientInsert?.sql).toContain('global_identity_id');
    expect(patientInsert?.sql).not.toContain('source');
  });

  test('POST /patients accepts a missing mobile when a reason + guardian contact are supplied', async () => {
    const result = createPatientSchema.safeParse({
      name: 'No Mobile Patient',
      fatherHusband: 'Md Karim',
      address: 'Village A',
      mobile: '',
      mobileMissingReason: 'no_personal_mobile',
      guardianName: 'Karim Mia',
      guardianRelation: 'father',
      village: 'Village A',
      unionName: 'Union B',
      upazila: 'Sadar',
      district: 'Dhaka',
      gender: 'male',
      age: 7,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mobile).toBeUndefined();
      expect(result.data.mobileMissingReason).toBe('no_personal_mobile');
    }
  });

  test('POST /patients rejects a missing mobile without a reason', () => {
    const result = createPatientSchema.safeParse({
      name: 'No Mobile Patient',
      fatherHusband: 'Md Karim',
      address: 'Village A',
      gender: 'male',
      age: 7,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('Mobile is missing — provide a reason and either a guardian contact (name + relation) or a full address (village + union + upazila + district).');
    }
  });

  test('POST /patients rejects a missing mobile with a reason but no alternative contact', () => {
    const result = createPatientSchema.safeParse({
      name: 'No Mobile Patient',
      fatherHusband: 'Md Karim',
      address: 'Village A',
      mobileMissingReason: 'no_personal_mobile',
      gender: 'male',
      age: 7,
    });
    expect(result.success).toBe(false);
  });

  test('UHID uniqueness is tenant-scoped for cross-hospital linking', () => {
    const sql = readFileSync('migrations/0244_patient_uhid_tenant_unique.sql', 'utf8');

    expect(sql).toContain('DROP INDEX IF EXISTS idx_patients_uhid');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_patients_uhid_tenant');
    expect(sql).toContain('ON patients(uhid, tenant_id)');
  });
});
