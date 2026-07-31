import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import publicHealthRecordRoutes from '../src/routes/public/healthRecord';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp } from './integration/helpers/test-app';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('public emergency health profile', () => {
  test('returns a minimal emergency profile for an active emergency card token', async () => {
    const rawToken = 'e'.repeat(40);
    const tokenHash = sha256(rawToken);
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from cln_problemlist')) {
          return {
            results: [{
              description: 'Diabetes mellitus',
              status: 'active',
            }],
            success: true,
            meta: {},
          };
        }
        return null;
      },
      tables: {
        health_record_access_tokens: [{
          id: 9,
          token_hash: tokenHash,
          national_id: '19901234567890123',
          tenant_id: 'tenant-1',
          patient_id: 50,
          scope: 'summary',
          is_active: 1,
          expires_at: '2099-12-31T00:00:00.000Z',
          access_count: 0,
        }],
        health_cards: [{
          id: 1,
          tenant_id: 'tenant-1',
          patient_id: 50,
          card_type: 'emergency',
          status: 'active',
          token_id: 9,
        }],
        patients: [{
          id: 50,
          tenant_id: 'tenant-1',
          name: 'Test Patient',
          age: 30,
          gender: 'female',
          blood_group: 'A+',
          date_of_birth: '1996-01-01',
          uhid: 'OZ-000050',
          mobile: '01711111111',
          guardian_mobile: '01700000000',
          father_husband: 'Rahim Uddin',
        }],
        tenants: [{
          id: 'tenant-1',
          name: 'Tenant Hospital',
        }],
        patient_guardians: [{
          id: 1,
          tenant_id: 'tenant-1',
          patient_id: 50,
          guardian_name: 'Rahim Uddin',
          relationship: 'father',
          phone: '01700000000',
          is_primary: 1,
        }],
        patient_allergies: [{
          id: 1,
          tenant_id: 'tenant-1',
          patient_id: 50,
          allergen: 'Penicillin',
          allergy_type: 'drug',
          severity: 'severe',
          reaction: 'Anaphylaxis',
          is_active: 1,
        }],
        patient_active_medications: [{
          id: 1,
          tenant_id: 'tenant-1',
          patient_id: 50,
          medication_name: 'Warfarin',
          generic_name: 'warfarin',
          status: 'active',
          is_active: 1,
        }],
        CLN_ProblemList: [],
        health_record_access_log: [],
      },
    });

    const { app } = createTestApp({
      route: publicHealthRecordRoutes as any,
      routePath: '/public',
      mockDB,
    });

    const res = await app.request(`/public/emergency/${rawToken}`, {
      headers: {
        'CF-Connecting-IP': '198.51.100.33',
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      access_type: string;
      profile: {
        patient: { blood_group: string | null };
        allergies: Array<{ allergen: string }>;
        emergency_contacts: Array<{ phone: string }>;
        current_medications: Array<{ medication_name: string }>;
        active_conditions: Array<{ description: string }>;
      };
    };

    expect(body.access_type).toBe('qr_scan');
    expect(body.profile.patient.blood_group).toBe('A+');
    expect(body.profile.allergies[0]?.allergen).toBe('Penicillin');
    expect(body.profile.emergency_contacts[0]?.phone).toBe('01700000000');
    expect(body.profile.current_medications[0]?.medication_name).toBe('Warfarin');
    expect(body.profile.active_conditions[0]?.description).toBe('Diabetes mellitus');
  });

  test('rejects a non-emergency token on the emergency endpoint', async () => {
    const rawToken = 'f'.repeat(40);
    const tokenHash = sha256(rawToken);
    const mockDB = createMockDB({
      tables: {
        health_record_access_tokens: [{
          id: 9,
          token_hash: tokenHash,
          national_id: '19901234567890123',
          tenant_id: 'tenant-1',
          patient_id: 50,
          scope: 'summary',
          is_active: 1,
          expires_at: '2099-12-31T00:00:00.000Z',
          access_count: 0,
        }],
        health_cards: [{
          id: 1,
          tenant_id: 'tenant-1',
          patient_id: 50,
          card_type: 'hospital',
          status: 'active',
          token_id: 9,
        }],
      },
    });

    const { app } = createTestApp({
      route: publicHealthRecordRoutes as any,
      routePath: '/public',
      mockDB,
    });

    const res = await app.request(`/public/emergency/${rawToken}`, {
      headers: {
        'CF-Connecting-IP': '198.51.100.34',
      },
    });

    expect(res.status).toBe(404);
  });
});
