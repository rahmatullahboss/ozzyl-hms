import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import { generateKeyPairSync } from 'node:crypto';
import globalPortalRoutes from '../src/routes/global-portal';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function buildGoogleWalletTestEnv() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicExponent: 0x10001,
  });

  return {
    GOOGLE_WALLET_ISSUER_ID: '3388000000022900001',
    GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: 'wallet-issuer@example.iam.gserviceaccount.com',
    GOOGLE_WALLET_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    APPLE_WALLET_PASS_TYPE_ID: 'pass.com.ozzyl.health',
    APPLE_WALLET_TEAM_ID: 'TEAM12345',
  };
}

function decodeJwtPayloadFromSaveUrl(url: string) {
  const encoded = url.split('/').pop();
  if (!encoded) throw new Error('Missing JWT in save URL');
  const [, payload] = encoded.split('.');
  if (!payload) throw new Error('Missing payload in JWT');
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return JSON.parse(Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8'));
}

describe('wallet export packaging', () => {
  it('returns wallet export payloads for a newly-created visit pass', async () => {
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
        if (normalized.includes('from patient_hospital_link_verifications')) {
          return {
            results: [{ id: 1, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid' }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id from patients where national_id = ? and tenant_id = ?')) {
          return { first: { id: 10 }, success: true, meta: {} };
        }
        return null;
      },
      tables: {
        patients: [
          { id: 10, tenant_id: 'tenant-1', uhid: 'OZ-12345', national_id: '19901234567890123', email: 'patient@example.com', mobile: '01711111111' },
          { id: 11, tenant_id: 'tenant-2', uhid: 'OZ-12345', national_id: '19901234567890123', email: 'patient@example.com', mobile: '01711111111' },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
          { id: 'tenant-2', name: 'Hospital Two' },
        ],
        patient_hospital_link_verifications: [
          { id: 1, global_user_id: 5, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid', revoked_at: null },
        ],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: buildGoogleWalletTestEnv(),
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
      pass_code: string;
      wallet_export: {
        google_wallet: { status: string; save_url: string };
        apple_wallet: { status: string; signing_required: boolean; pass_json: { serialNumber: string } };
      };
    };

    expect(body.wallet_export.google_wallet.status).toBe('ready');
    expect(body.wallet_export.google_wallet.save_url).toContain('https://pay.google.com/gp/v/save/');
    const jwtPayload = decodeJwtPayloadFromSaveUrl(body.wallet_export.google_wallet.save_url);
    expect(jwtPayload.typ).toBe('savetowallet');
    expect(body.wallet_export.apple_wallet.status).toBe('source_only');
    expect(body.wallet_export.apple_wallet.signing_required).toBe(true);
    expect(body.wallet_export.apple_wallet.pass_json.serialNumber).toContain(body.pass_code);
  });

  it('returns wallet export payloads for a patient emergency pack', async () => {
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
              name: 'Test Patient',
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
              primary_name: 'Test Patient',
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
        if (normalized.includes('from patient_hospital_link_verifications')) {
          return {
            results: [{ id: 1, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid' }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id from patients where national_id = ? and tenant_id = ?')) {
          return { first: { id: 10 }, success: true, meta: {} };
        }
        if (normalized.includes('from patients p') && normalized.includes('join tenants t on t.id = p.tenant_id')) {
          return {
            results: [{
              tenant_id: 'tenant-1',
              hospital_name: 'Hospital One',
              patient_id: 10,
            }],
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
        if (normalized.includes('select id, national_id') && normalized.includes('from patients') && normalized.includes('where id = ?')) {
          return {
            first: { id: 10, national_id: '19901234567890123' },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from cln_problemlist')) {
          return {
            results: [{ description: 'Diabetes mellitus', status: 'active' }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        patients: [
          {
            id: 10,
            tenant_id: 'tenant-1',
            uhid: 'OZ-12345',
            national_id: '19901234567890123',
            email: 'patient@example.com',
            mobile: '01711111111',
            name: 'Test Patient',
            age: 30,
            gender: 'female',
            blood_group: 'A+',
            guardian_mobile: '01700000000',
            father_husband: 'Rahim Uddin',
          },
        ],
        tenants: [
          { id: 'tenant-1', name: 'Hospital One' },
        ],
        patient_guardians: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, guardian_name: 'Rahim Uddin', relationship: 'father', phone: '01700000000', is_primary: 1 },
        ],
        patient_allergies: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, allergen: 'Penicillin', allergy_type: 'drug', severity: 'severe', reaction: 'Anaphylaxis', is_active: 1 },
        ],
        patient_active_medications: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active', is_active: 1 },
        ],
        patient_hospital_link_verifications: [
          { id: 1, global_user_id: 5, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid', revoked_at: null },
        ],
        health_record_access_tokens: [],
        health_cards: [],
        CLN_ProblemList: [],
      },
    });

    const { app } = createTestApp({
      route: globalPortalRoutes as any,
      routePath: '/api/global-portal',
      mockDB,
      jwtSecret: 'test-secret',
      extraEnv: buildGoogleWalletTestEnv(),
    });

    const token = await sign(
      { userId: 5, scope: 'global', role: 'patient' },
      'test-secret',
      'HS256',
    );

    const res = await jsonRequest(app, '/api/global-portal/emergency-pack', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { duration_hours: 720 },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      public_url: string;
      wallet_export: {
        google_wallet: { status: string; save_url: string };
        apple_wallet: { status: string; pass_json: { serialNumber: string } };
      };
    };

    expect(body.wallet_export.google_wallet.status).toBe('ready');
    const jwtPayload = decodeJwtPayloadFromSaveUrl(body.wallet_export.google_wallet.save_url);
    expect(jwtPayload.typ).toBe('savetowallet');
    expect(body.wallet_export.apple_wallet.status).toBe('source_only');
    expect(body.wallet_export.apple_wallet.pass_json.serialNumber).toContain('emergency');
    expect(body.public_url).toContain('/api/public/emergency/');
  });
});
