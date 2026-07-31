import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import patientAuthRoutes from '../src/routes/patient-auth';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function findQuery(
  queries: Array<{ sql: string; params: unknown[]; method: string }>,
  pattern: string,
  method?: string,
) {
  return queries.find((query) =>
    query.sql.toLowerCase().includes(pattern.toLowerCase()) && (!method || query.method === method));
}

describe('patient auth global identity claim flow', () => {
  test('register reuses existing unclaimed identity in pending verification state', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select id from global_patient_auth where email = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('select id from global_patient_auth where phone = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_identity') && normalized.includes('where national_id = ?') && params[0] === '19901234504256784') {
          return {
            results: [{
              id: 7,
              uhid: 'OZ-000123',
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
              created_source: 'hospital',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into global_patient_auth')) {
          return {
            success: true,
            meta: { last_row_id: 21 },
          };
        }

        if (normalized.includes('pragma table_info(global_patient_auth)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'identity_id' },
              { name: 'name' },
              { name: 'email' },
              { name: 'phone' },
              { name: 'password_hash' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'email_verified' },
            ],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('update global_patient_identity') && normalized.includes("claim_status = 'claimed'")) {
          return {
            success: true,
            meta: { changes: 1 },
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/register', {
      method: 'POST',
      body: {
        name: 'Rahim Uddin',
        email: 'rahim@example.com',
        phone: '01712345678',
        national_id: '19901234504256784',
        password: 'Test1234',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      user: { uhid: string; identityStatus: string };
      proof_required: string[];
    };
    expect(body.user.uhid).toBe('OZ-000123');
    expect(body.user.identityStatus).toBe('pending_verification');
    expect(body.proof_required).toContain('claim_code');

    const authInsert = findQuery(mockDB.queries, 'insert into global_patient_auth', 'run');
    expect(authInsert?.params).toContain('OZ-000123');

    const identityClaim = findQuery(mockDB.queries, "claim_status = 'claimed'", 'run');
    expect(identityClaim).toBeUndefined();
  });

  test('POST /claim-card creates a portal auth account for an unclaimed hospital card', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select id from global_patient_auth where email = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('select id from global_patient_auth where phone = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?') && params[0] === 'OZ-000555') {
          return {
            first: {
              id: 55,
              uhid: 'OZ-000555',
              primary_name: 'Hospital Created',
              primary_phone: '01812345678',
              national_id: '19901234504256784',
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into global_patient_auth')) {
          return {
            success: true,
            meta: { last_row_id: 77 },
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/claim-card', {
      method: 'POST',
      body: {
        uhid: 'OZ-000555',
        name: 'Claimed User',
        phone: '01812345678',
        password: 'Claim1234',
      },
    });

    expect(res.status).toBe(201);

    const authInsert = findQuery(mockDB.queries, 'insert into global_patient_auth', 'run');
    expect(authInsert?.params).toContain(55);
    expect(authInsert?.params).toContain('OZ-000555');

    const identityClaim = findQuery(mockDB.queries, 'update global_patient_identity', 'run');
    expect(identityClaim?.params).toEqual([77, 55]);
  });

  test('POST /claim-card rejects claim when hospital card has no stored verifier', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select id from global_patient_auth where phone = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?') && params[0] === 'OZ-000777') {
          return {
            first: {
              id: 88,
              uhid: 'OZ-000777',
              primary_name: 'Unknown Patient',
              primary_phone: null,
              national_id: null,
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
            },
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/claim-card', {
      method: 'POST',
      body: {
        uhid: 'OZ-000777',
        phone: '01912345678',
        password: 'Claim1234',
      },
    });

    expect(res.status).toBe(403);
    expect(findQuery(mockDB.queries, 'insert into global_patient_auth', 'run')).toBeUndefined();
    expect(findQuery(mockDB.queries, 'update global_patient_identity', 'run')).toBeUndefined();
  });

  test('POST /claim-card accepts a valid claim code when no phone or NID verifier exists', async () => {
    const claimCode = 'C-8F4K2Q';
    const claimCodeHash = createHash('sha256').update(claimCode).digest('hex');

    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('select id from global_patient_auth where phone = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?') && params[0] === 'OZ-000888') {
          return {
            first: {
              id: 99,
              uhid: 'OZ-000888',
              primary_name: 'Slip Only Patient',
              primary_phone: null,
              national_id: null,
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patient_claim_codes')) {
          return {
            first: {
              id: 44,
              code_hash: claimCodeHash,
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('insert into global_patient_auth')) {
          return {
            success: true,
            meta: { last_row_id: 111 },
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/claim-card', {
      method: 'POST',
      body: {
        uhid: 'OZ-000888',
        claim_code: claimCode,
        password: 'Claim1234',
      },
    });

    expect(res.status).toBe(201);
    expect(findQuery(mockDB.queries, 'update patient_claim_codes set used_at', 'run')).toBeTruthy();
    const authInsert = findQuery(mockDB.queries, 'insert into global_patient_auth', 'run');
    expect(authInsert?.params).toContain(99);
    expect(authInsert?.params).toContain('OZ-000888');
  });

  test('POST /claim-card locks repeated invalid claim code attempts for the same UHID', async () => {
    const validClaimHash = createHash('sha256').update('C-RIGHT1').digest('hex');
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?') && params[0] === 'OZ-000901') {
          return {
            first: {
              id: 109,
              uhid: 'OZ-000901',
              primary_name: 'Locked Patient',
              primary_phone: null,
              national_id: null,
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patient_claim_codes')) {
          if (params[1] !== validClaimHash) {
            return null;
          }
          return {
            first: {
              id: 73,
              code_hash: validClaimHash,
            },
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await jsonRequest(app, '/patient-auth/claim-card', {
        method: 'POST',
        body: {
          uhid: 'OZ-000901',
          claim_code: 'C-WRNG22',
          password: 'Claim1234',
        },
        headers: {
          'CF-Connecting-IP': '203.0.113.20',
        },
      });

      expect(res.status).toBe(403);
    }

    const locked = await jsonRequest(app, '/patient-auth/claim-card', {
      method: 'POST',
      body: {
        uhid: 'OZ-000901',
        claim_code: 'C-WRNG22',
        password: 'Claim1234',
      },
      headers: {
        'CF-Connecting-IP': '203.0.113.20',
      },
    });

    expect(locked.status).toBe(429);
  });

  test('register succeeds against legacy auth schema without identity_id linkage column', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('pragma table_info(global_patient_auth)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'name' },
              { name: 'email' },
              { name: 'phone' },
              { name: 'password_hash' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'email_verified' },
            ],
          };
        }

        if (normalized.includes('pragma table_info(global_patient_identity)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'primary_name' },
              { name: 'primary_phone' },
              { name: 'primary_email' },
              { name: 'date_of_birth' },
              { name: 'gender' },
            ],
          };
        }

        if (normalized.includes('select id from global_patient_auth where email = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('select id from global_patient_auth where phone = ?')) {
          return { first: null, success: true, meta: {} };
        }

        if (normalized.includes('returning last_value')) {
          return { first: { last_value: 222 }, success: true, meta: {} };
        }

        if (normalized.includes('insert into global_patient_auth')) {
          return {
            success: true,
            meta: { last_row_id: 303 },
          };
        }

        return null;
      },
    });

    const { app } = createTestApp({
      route: patientAuthRoutes,
      routePath: '/patient-auth',
      mockDB,
    });

    const res = await jsonRequest(app, '/patient-auth/register', {
      method: 'POST',
      body: {
        name: 'Legacy Portal User',
        email: 'legacy@example.com',
        phone: '01712345678',
        password: 'Test1234',
      },
    });

    expect(res.status).toBe(201);

    const authInsert = findQuery(mockDB.queries, 'insert into global_patient_auth', 'run');
    expect(authInsert).toBeDefined();
    expect(authInsert?.sql).not.toContain('identity_id');

    const identityClaim = findQuery(mockDB.queries, 'update global_patient_identity', 'run');
    expect(identityClaim).toBeUndefined();
  });
});
