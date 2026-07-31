import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import globalPortalRoutes from '../src/routes/global-portal';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('global visit pass', () => {
  it('creates a summary-only visit pass for the patient', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Patient One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Patient One',
              primary_phone: '01711111111',
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
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
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', national_id: 'NID-12345', email: 'patient@example.com', mobile: '01711111111' },
          { id: 11, tenant_id: 'tenant-2', uhid: 'OZ-12345', national_id: 'NID-12345', email: 'patient@example.com', mobile: '01711111111' },
        ],
        patient_hospital_link_verifications: [
          { id: 1, global_user_id: 5, tenant_id: 'tenant-1', national_id: 'NID-12345', verification_method: 'claim_code', revoked_at: null },
          { id: 2, global_user_id: 5, tenant_id: 'tenant-2', national_id: 'NID-12345', verification_method: 'claim_code', revoked_at: null },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
          { id: 'tenant-2', name: 'Hospital Two' },
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
      body: { duration_hours: 24 },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      token: string;
      pass_code: string;
      scope: string;
      expires_at: string;
      qr_payload: string;
    };

    expect(body.token.length).toBeGreaterThanOrEqual(32);
    expect(body.pass_code).toMatch(/^VP-[A-Z2-9]{6}$/);
    expect(body.scope).toBe('summary');
    expect(body.expires_at).toBeTruthy();
    expect(body.qr_payload).toContain(body.token);
  });

  it('lists active and recent visit passes for the patient', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: '01711111111',
              uhid: 'OZ-12345',
              name: 'Patient One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Patient One',
              primary_phone: '01711111111',
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
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
        if (normalized.includes('select id, name from tenants') && normalized.includes('json_each')) {
          return {
            results: [
              { id: 'tenant-1', name: 'Hospital One' },
              { id: 'tenant-2', name: 'Hospital Two' },
            ],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        patient_visit_passes: [
          {
            id: 1,
            global_user_id: 5,
            code_last4: 'AB23',
            is_active: 1,
            expires_at: '2099-12-31T00:00:00.000Z',
            redeemed_at: null,
            redeemed_by_tenant_id: null,
            revoked_at: null,
            created_at: '2099-01-01T00:00:00.000Z',
          },
          {
            id: 2,
            global_user_id: 5,
            code_last4: 'ZZ19',
            is_active: 1,
            expires_at: '2099-12-31T00:00:00.000Z',
            redeemed_at: '2099-01-02T00:00:00.000Z',
            redeemed_by_tenant_id: 'tenant-2',
            revoked_at: null,
            created_at: '2099-01-02T00:00:00.000Z',
          },
        ],
        tenants: [
          { id: 'tenant-2', name: 'Hospital Two' },
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
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      active_pass: { id: number; status: string } | null;
      recent_passes: Array<{ id: number; status: string; redeemed_hospital: string | null }>;
    };

    expect(body.active_pass?.id).toBe(1);
    expect(body.active_pass?.status).toBe('active');
    expect(body.recent_passes).toHaveLength(2);
    expect(body.recent_passes.find((item) => item.id === 2)?.redeemed_hospital).toBe('Hospital Two');
  });

  it('includes patient guidance in dashboard payload', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('select identity_id, email, phone, uhid, name from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              identity_id: 11,
              email: 'patient@example.com',
              phone: null,
              uhid: 'OZ-12345',
              name: 'Patient One',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id, uhid, primary_name, primary_phone, primary_email, date_of_birth, gender, claim_status') && normalized.includes('from global_patient_identity') && normalized.includes('where id = ?')) {
          return {
            first: {
              id: 11,
              uhid: 'OZ-12345',
              primary_name: 'Patient One',
              primary_phone: null,
              primary_email: 'patient@example.com',
              date_of_birth: '1990-01-01',
              gender: 'female',
              claim_status: 'claimed',
            },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_auth where id = ? and is_active = 1')) {
          return {
            first: {
              national_id: null,
            },
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
        if (normalized.includes('count(*) as vault_documents from global_patient_vault_documents')) {
          return {
            first: { vault_documents: 0 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_reported_data') && normalized.includes("verification_status in ('unconfirmed', 'pending_review')")) {
          return {
            first: { total: 1 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_adverse_reactions') && normalized.includes("review_status = 'pending_review'")) {
          return {
            first: { total: 1 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_reported_data') && normalized.includes("verification_status = 'confirmed'")) {
          return {
            first: { total: 1 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('count(*) as active_visit_pass from patient_visit_passes')) {
          return {
            first: { active_visit_pass: 0 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('count(*) as recent_lifestyle_log from global_patient_lifestyle_logs')) {
          return {
            first: { recent_lifestyle_log: 1 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('count(*) as recent_adr from global_patient_adverse_reactions')) {
          return {
            first: { recent_adr: 1 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_lifestyle_logs') && normalized.includes("review_status = 'pending_review'")) {
          return {
            first: { total: 0 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_adverse_reactions') && normalized.includes("review_status = 'verified'")) {
          return {
            first: { total: 0 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from global_patient_lifestyle_logs') && normalized.includes("review_status = 'verified'")) {
          return {
            first: { total: 0 },
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', national_id: 'NID-12345', email: 'patient@example.com', mobile: '01711111111' },
        ],
        patient_hospital_link_verifications: [
          { id: 3, global_user_id: 5, tenant_id: 'tenant-1', national_id: 'NID-12345', verification_method: 'claim_code', revoked_at: null },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
        ],
        appointments: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, appt_date: '2099-05-01', appt_time: '10:00', status: 'booked', chief_complaint: 'Follow up', doctor_id: 1 },
        ],
        prescriptions: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, created_at: '2099-04-01T00:00:00.000Z', chief_complaint: 'Fever', diagnosis: 'Observation', doctor_id: 1 },
        ],
        doctors: [
          { id: 1, tenant_id: 'tenant-1', name: 'Dr One', specialty: 'Medicine' },
        ],
        bills: [],
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

    const res = await jsonRequest(app, '/api/global-portal/dashboard', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      patient_guidance?: {
        status: string;
        next_steps: string[];
        trust_notes: string[];
      };
    };

    expect(body.patient_guidance?.status).toBe('attention');
    expect(body.patient_guidance?.next_steps.some((item) => item.toLowerCase().includes('phone'))).toBe(true);
    expect(body.patient_guidance?.trust_notes.some((item) => item.toLowerCase().includes('pending review'))).toBe(true);
  });
});
