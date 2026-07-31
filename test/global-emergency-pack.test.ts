import { describe, expect, it } from 'vitest';
import { sign } from 'hono/jwt';
import globalPortalRoutes from '../src/routes/global-portal';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

describe('global emergency pack', () => {
  it('creates a patient emergency pack with public url and profile snapshot', async () => {
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
        if (normalized.includes('from patient_hospital_link_verifications')) {
          return {
            first: { id: 1, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid' },
            results: [{ id: 1, tenant_id: 'tenant-1', national_id: '19901234567890123', verification_method: 'nid' }],
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('select id from patients where national_id = ? and tenant_id = ?')) {
          return { first: { id: 10 }, success: true, meta: {} };
        }
        if (normalized.includes('select id, national_id') && normalized.includes('from patients') && normalized.includes('where id = ?')) {
          return { first: { id: 10, national_id: '19901234567890123' }, success: true, meta: {} };
        }
        if (normalized.includes('select name from tenants where id = ?')) {
          return {
            first: { name: 'Hospital One' },
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
        health_record_access_tokens: [],
        health_cards: [],
        patient_hospital_link_verifications: [
          { id: 1, tenant_id: 'tenant-1', identity_id: 11, patient_id: 10, national_id: '19901234567890123', verification_method: 'nid' },
        ],
        CLN_ProblemList: [],
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

    const res = await jsonRequest(app, '/api/global-portal/emergency-pack', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { duration_hours: 720 },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as {
      public_url: string;
      qr_payload: string;
      card_type: string;
      profile: {
        patient: { blood_group: string | null; uhid: string | null };
        allergies: Array<{ allergen: string }>;
      };
    };

    expect(body.card_type).toBe('emergency');
    expect(body.public_url).toContain('/api/public/emergency/');
    expect(body.qr_payload).toContain('/api/public/emergency/');
    expect(body.profile.patient.blood_group).toBe('A+');
    expect(body.profile.patient.uhid).toBe('OZ-12345');
    expect(body.profile.allergies[0]?.allergen).toBe('Penicillin');
  });
});
