import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import globalPortalRoutes from '../src/routes/global-portal';
import { getCurrentAuthIdentity } from '../src/lib/family-graph';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function findQuery(
  queries: { sql: string; method: string }[],
  needle: string,
  method?: string,
) {
  return queries.find((query) => {
    const normalized = query.sql.toLowerCase();
    return normalized.includes(needle) && (!method || query.method === method);
  });
}

describe('global family graph', () => {
  it('backfills missing auth identity links from the existing global UHID', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: null,
              email: 'legacy@example.com',
              phone: '01710000000',
              uhid: 'OZ-LEGACY-001',
              name: 'Legacy Patient',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(global_patient_auth)') || normalized.includes('pragma table_info("global_patient_auth")')) {
          return {
            results: [
              { name: 'id' },
              { name: 'identity_id' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'email' },
              { name: 'phone' },
              { name: 'name' },
              { name: 'updated_at' },
              { name: 'is_active' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(global_patient_identity)') || normalized.includes('pragma table_info("global_patient_identity")')) {
          return {
            results: [
              { name: 'id' },
              { name: 'national_id' },
              { name: 'uhid' },
              { name: 'primary_name' },
              { name: 'primary_phone' },
              { name: 'primary_email' },
              { name: 'claim_status' },
              { name: 'claimed_auth_user_id' },
              { name: 'created_source' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select national_id from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: { national_id: null },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, claim_status, claimed_auth_user_id from global_patient_identity where uhid = ?')) {
          return {
            first: {
              id: 321,
              uhid: 'OZ-LEGACY-001',
              claim_status: 'claimed',
              claimed_auth_user_id: 77,
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('update global_patient_auth')) {
          return {
            success: true,
            meta: { changes: 1 },
          };
        }
        return null;
      },
    });

    const auth = await getCurrentAuthIdentity(mockDB.db as any, 77);

    expect(auth.identityId).toBe(321);
    expect(auth.uhid).toBe('OZ-LEGACY-001');
    expect(findQuery(mockDB.queries as any[], 'update global_patient_auth', 'run')).toBeTruthy();
  });

  it('creates a managed dependent profile for the signed-in family manager', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('update uhid_sequence set last_value = last_value + 1 where id = 1')) {
          return {
            first: { last_value: 501 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert into global_patient_identity')) {
          return {
            success: true,
            meta: { last_row_id: 901, changes: 1 },
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 901,
              uhid: 'OZ-DEP-001',
              primary_name: 'Child One',
              primary_phone: null,
              primary_email: null,
              date_of_birth: '2018-05-02',
              gender: 'female',
              claim_status: 'unclaimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/dependents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'Child One',
        relationship: 'child',
        date_of_birth: '2018-05-02',
        gender: 'female',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      dependent: {
        identity_id: number;
        uhid: string;
        relationship: string;
        claim_status: string;
      };
    };

    expect(body.dependent.identity_id).toBe(901);
    expect(body.dependent.uhid).toMatch(/^OZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.dependent.relationship).toBe('child');
    expect(body.dependent.claim_status).toBe('unclaimed');
  });

  it('accepts the patient app family members alias for creating dependents', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('update uhid_sequence set last_value = last_value + 1 where id = 1')) {
          return {
            first: { last_value: 777 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert into global_patient_identity')) {
          return {
            success: true,
            meta: { last_row_id: 977, changes: 1 },
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 977,
              uhid: 'OZ-DEP-777',
              primary_name: 'Family Member',
              primary_phone: '01719999999',
              primary_email: null,
              date_of_birth: null,
              gender: null,
              claim_status: 'unclaimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/members', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'Family Member',
        relationship: 'child',
        phone: '01719999999',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      dependent: {
        identity_id: number;
        uhid: string;
        relationship: string;
      };
    };

    expect(body.dependent.identity_id).toBe(977);
    expect(body.dependent.uhid).toMatch(/^OZ-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(body.dependent.relationship).toBe('child');
  });

  it('returns family risk overview from linked biologic relatives', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from sqlite_master') && params[0] === 'patient_visit_passes') {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_family_links gfl') && normalized.includes('join global_patient_identity gpi')) {
          return {
            results: [
              {
                id: 51,
                patient_identity_id: 777,
                relationship: 'parent',
                access_role: 'manager',
                verification_basis: 'linked_existing',
                status: 'active',
                created_at: '2026-04-10T10:00:00Z',
                uhid: 'OZ-PARENT-001',
                primary_name: 'Father One',
                date_of_birth: '1964-09-01',
                gender: 'male',
                claim_status: 'unclaimed',
              },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_hospital_link_verifications')) {
          return {
            results: [
              { tenant_id: 'tenant-1', national_id: 'NID-FATHER-001' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id from patients where national_id = ? and tenant_id = ?')) {
          return {
            first: { id: 3001 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select name from tenants where id = ?')) {
          return {
            first: { name: 'Hospital One' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from clinicaldiagnosis')) {
          return {
            results: [
              {
                description: 'Type 2 diabetes mellitus',
                icd10_code: 'E11',
              },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from final_diagnosis fd')) {
          return {
            results: [],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return {
            first: { name: 'mock_table' },
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      risk_overview?: {
        status: string;
        insights: Array<{ domain: string; first_degree_count: number }>;
      };
    };

    expect(body.risk_overview?.status).toBe('attention');
    expect(body.risk_overview?.insights[0]?.domain).toBe('diabetes');
    expect(body.risk_overview?.insights[0]?.first_degree_count).toBe(1);
  });

  it('rejects unverified adult dependent creation with identity-driving identifiers', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/dependents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: 'Father One',
        relationship: 'parent',
        date_of_birth: '1964-09-01',
        phone: '01719999999',
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json() as { error?: string };
    expect(body.error).toContain('cannot add phone or NID');
  });

  it('links an existing unclaimed profile to a caregiver using claim proof', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return {
            first: {
              id: 777,
              uhid: params[0],
              primary_name: 'Elder Patient',
              primary_phone: '01755555555',
              national_id: null,
              claim_status: 'unclaimed',
              claimed_auth_user_id: null,
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_claim_codes') && normalized.includes('where identity_id = ? and code_hash = ?')) {
          return {
            first: {
              id: 55,
              code_hash: params[1],
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 777,
              uhid: 'OZ-ELDER-001',
              primary_name: 'Elder Patient',
              primary_phone: '01755555555',
              primary_email: null,
              date_of_birth: '1949-02-10',
              gender: 'male',
              claim_status: 'unclaimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
        patient_claim_codes: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/link-existing', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        uhid: 'OZ-ELDER-001',
        relationship: 'caregiver',
        claim_code: 'ABC123',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      linked_profile: {
        identity_id: number;
        uhid: string;
        relationship: string;
      };
    };

    expect(body.linked_profile.identity_id).toBe(777);
    expect(body.linked_profile.uhid).toBe('OZ-ELDER-001');
    expect(body.linked_profile.relationship).toBe('caregiver');
  });

  it('lets a manager load a dependent dashboard via managed identity context', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_family_links') && normalized.includes('manager_auth_user_id = ?') && normalized.includes('patient_identity_id = ?')) {
          return {
            first: {
              id: 44,
              patient_identity_id: 777,
              relationship: 'child',
              access_role: 'manager',
              status: 'active',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 777,
              uhid: 'OZ-CHILD-001',
              primary_name: 'Child One',
              primary_phone: null,
              primary_email: null,
              date_of_birth: '2018-05-02',
              gender: 'female',
              claim_status: 'unclaimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select national_id from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              national_id: null,
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from sqlite_master') && normalized.includes("name = ?")) {
          return { first: { name: 'mock_table' }, success: true, meta: {} };
        }
        if (normalized.includes('count(*) as vault_documents from global_patient_vault_documents')) {
          return { first: { vault_documents: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from global_patient_reported_data') && normalized.includes("verification_status in ('unconfirmed', 'pending_review')")) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from global_patient_adverse_reactions') && normalized.includes("review_status = 'pending_review'")) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from global_patient_lifestyle_logs') && normalized.includes("review_status = 'pending_review'")) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from global_patient_reported_data') && normalized.includes("verification_status = 'confirmed'")) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from global_patient_adverse_reactions') && normalized.includes("review_status = 'verified'")) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('from global_patient_lifestyle_logs') && normalized.includes("review_status = 'verified'")) {
          return { first: { total: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('count(*) as active_visit_pass from patient_visit_passes')) {
          return { first: { active_visit_pass: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('count(*) as recent_lifestyle_log from global_patient_lifestyle_logs')) {
          return { first: { recent_lifestyle_log: 0 }, success: true, meta: {} };
        }
        if (normalized.includes('count(*) as recent_adr from global_patient_adverse_reactions')) {
          return { first: { recent_adr: 0 }, success: true, meta: {} };
        }
        return null;
      },
      tables: {
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-CHILD-001', national_id: 'NID-CHILD-001', name: 'Child One' },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
        ],
        appointments: [],
        prescriptions: [],
        doctors: [],
        bills: [],
        patient_hospital_link_verifications: [
          {
            id: 91,
            global_user_id: 5,
            tenant_id: 'tenant-1',
            national_id: 'NID-CHILD-001',
            verification_method: 'family_link',
            verified_at: '2026-06-01T09:00:00Z',
            revoked_at: null,
          },
        ],
        global_family_links: [
          {
            id: 44,
            patient_identity_id: 777,
            manager_auth_user_id: 5,
            relationship: 'child',
            access_role: 'manager',
            verification_basis: 'dependent_created',
            status: 'active',
          },
        ],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/dashboard?managed_identity_id=777', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      acting_profile?: {
        identity_id: number;
        name: string;
        relationship: string | null;
        managed: boolean;
      };
      hospitalsCount: number;
    };

    expect(body.acting_profile?.identity_id).toBe(777);
    expect(body.acting_profile?.managed).toBe(true);
    expect(body.acting_profile?.relationship).toBe('child');
    expect(body.hospitalsCount).toBe(1);
  });

  it('creates a visit pass for the selected managed family profile', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from sqlite_master') && params[0] === 'patient_visit_passes') {
          return {
            first: { name: 'patient_visit_passes' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('pragma table_info(patient_visit_passes)')) {
          return {
            results: [
              { name: 'id' },
              { name: 'token_hash' },
              { name: 'code_hash' },
              { name: 'code_last4' },
              { name: 'global_user_id' },
              { name: 'uhid' },
              { name: 'is_active' },
              { name: 'expires_at' },
              { name: 'wallet_payload_encrypted' },
            ],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_family_links') && normalized.includes('manager_auth_user_id = ?') && normalized.includes('patient_identity_id = ?')) {
          return {
            first: {
              id: 44,
              patient_identity_id: 777,
              relationship: 'child',
              access_role: 'manager',
              status: 'active',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 777,
              uhid: 'OZ-CHILD-001',
              primary_name: 'Child One',
              primary_phone: null,
              primary_email: null,
              date_of_birth: '2018-05-02',
              gender: 'female',
              claim_status: 'unclaimed',
            },
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-CHILD-001', national_id: 'NID-CHILD-001', name: 'Child One' },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
        ],
        patient_hospital_link_verifications: [
          {
            id: 92,
            global_user_id: 5,
            tenant_id: 'tenant-1',
            national_id: 'NID-CHILD-001',
            verification_method: 'family_link',
            verified_at: '2026-06-01T09:00:00Z',
            revoked_at: null,
          },
        ],
        global_family_links: [
          {
            id: 44,
            patient_identity_id: 777,
            manager_auth_user_id: 5,
            relationship: 'child',
            access_role: 'manager',
            verification_basis: 'dependent_created',
            status: 'active',
          },
        ],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/visit-pass', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { duration_hours: 12, managed_identity_id: 777 },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      acting_profile?: { identity_id: number; managed: boolean };
      hospitals: Array<{ hospital_name: string }>;
      pass_code: string;
    };

    expect(body.acting_profile?.identity_id).toBe(777);
    expect(body.acting_profile?.managed).toBe(true);
    expect(body.hospitals.length).toBeGreaterThanOrEqual(0);
    expect(body.pass_code).toMatch(/^VP-[A-Z2-9]{6}$/);
  });

  it('creates a proxy invite for a claimed family member instead of direct linking', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return {
            first: {
              id: 888,
              uhid: params[0],
              primary_name: 'Adult Daughter',
              claim_status: 'claimed',
              claimed_auth_user_id: 42,
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, status from global_family_proxy_invites')) {
          return { first: null, success: true, meta: {} };
        }
        if (normalized.includes('insert into global_family_proxy_invites')) {
          return {
            success: true,
            meta: { last_row_id: 991, changes: 1 },
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
        global_family_proxy_invites: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/proxy-invites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        uhid: 'OZ-ADULT-001',
        relationship: 'parent',
        notes: 'My mother needs help with appointments',
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      invite?: {
        patient_identity_id: number;
        invitee_auth_user_id: number;
        status: string;
      };
    };

    expect(body.invite?.patient_identity_id).toBe(888);
    expect(body.invite?.invitee_auth_user_id).toBe(42);
    expect(body.invite?.status).toBe('pending');
  });

  it('rejects self-targeted proxy invites', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_identity') && normalized.includes('where uhid = ?')) {
          return {
            first: {
              id: 11,
              uhid: params[0],
              primary_name: 'Manager One',
              claim_status: 'claimed',
              claimed_auth_user_id: 5,
            },
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
        global_family_proxy_invites: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/proxy-invites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        uhid: 'OZ-MANAGER',
        relationship: 'other',
      },
    });

    expect(res.status).toBe(409);
  });

  it('lets the claimed family member accept a proxy invite and creates an active manager link', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 42,
              email: 'adult@example.com',
              phone: '01777777777',
              uhid: 'OZ-ADULT-001',
              name: 'Adult Daughter',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_family_proxy_invites gfpi') && normalized.includes('where gfpi.id = ?')) {
          return {
            first: {
              id: 991,
              patient_identity_id: 888,
              inviter_auth_user_id: 5,
              invitee_auth_user_id: 42,
              relationship: 'parent',
              access_role: 'manager',
              status: 'pending',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select count(*) as active_count from global_family_links where patient_identity_id = ? and status = \'active\'')) {
          return {
            first: { active_count: 0 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('insert into global_family_links')) {
          return {
            success: true,
            meta: { last_row_id: 77, changes: 1 },
          };
        }
        if (normalized.includes('update global_family_proxy_invites') && normalized.includes('accepted_at = datetime(\'now\')')) {
          return {
            success: true,
            meta: { changes: 1 },
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
        global_family_proxy_invites: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 42, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/proxy-invites/991/respond', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { action: 'accept' },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      accepted?: boolean;
      link?: {
        patient_identity_id: number;
        manager_auth_user_id: number;
        access_role: string;
      };
    };

    expect(body.accepted).toBe(true);
    expect(body.link?.patient_identity_id).toBe(888);
    expect(body.link?.manager_auth_user_id).toBe(5);
    expect(body.link?.access_role).toBe('primary_manager');
  });

  it('transfers primary manager role to another active family manager', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'manager@example.com',
              phone: '01711111111',
              uhid: 'OZ-MANAGER',
              name: 'Manager One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_family_links current_link') && normalized.includes('manager_auth_user_id = ?') && normalized.includes('patient_identity_id = ?')) {
          return {
            first: {
              id: 501,
              patient_identity_id: 777,
              manager_auth_user_id: 5,
              access_role: 'primary_manager',
              status: 'active',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_family_links target_link') && normalized.includes('where target_link.id = ?')) {
          return {
            first: {
              id: 502,
              patient_identity_id: 777,
              manager_auth_user_id: 9,
              access_role: 'manager',
              status: 'active',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('update global_family_links') && normalized.includes('set access_role = case')) {
          return {
            success: true,
            meta: { changes: 2 },
          };
        }
        return null;
      },
      tables: {
        global_family_links: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/family/links/502/make-primary', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      transferred?: boolean;
      primary_manager_link_id?: number;
    };

    expect(body.transferred).toBe(true);
    expect(body.primary_manager_link_id).toBe(502);
  });
});
