import { describe, expect, it } from 'vitest';
import healthRecordRoutes from '../src/routes/tenant/healthRecord';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const TOKEN_ROW = {
  id: 77,
  tenant_id: 'tenant-a',
  patient_id: 10,
  uhid: 'OZ-8F4K-92Q7',
  card_version: 1,
  status: 'active',
  source_hospital_name: 'Source Hospital',
  global_identity_id: 500,
  national_id: '19901234567890123',
  patient_code: 'P-000010',
  name: 'Sokina',
  father_husband: 'Rahim',
  address: 'DKP Road',
  mobile: '01718128478',
  email: 'sokina@example.test',
  age: 27,
  gender: 'female',
  blood_group: 'AB+',
  date_of_birth: '1999-01-01',
  guardian_mobile: '01700000000',
  primary_name: 'Sokina',
  primary_phone: '01718128478',
  primary_email: 'sokina@example.test',
};

describe('patient card QR flow', () => {
  it('issues an opaque printable QR payload without embedding patient demographics', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from patients') && normalized.includes('global_identity_id')) {
          return {
            first: { id: 10, tenant_id: 'tenant-a', uhid: 'OZ-8F4K-92Q7', global_identity_id: 500 },
            success: true,
            meta: {},
          };
        }
        if (normalized.includes('from patient_card_qr_tokens') && normalized.includes("status = 'active'")) {
          return { first: null, success: true, meta: {} };
        }
        if (normalized.includes('select max(card_version)')) {
          return { first: { mv: 0 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: healthRecordRoutes,
      routePath: '/api',
      role: 'reception',
      tenantId: 'tenant-a',
      userId: 3,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/health-record/patients/10/card-qr-token', {
      method: 'POST',
      body: { reissue: true },
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.qr_payload).toContain('/qr/patient-card/');
    expect(data.qr_payload).not.toContain('Sokina');
    expect(data.qr_payload).not.toContain('01718128478');
    expect(data.qr_payload).not.toContain('OZ-8F4K-92Q7');
    expect(mockDB.queries.some((q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_card_qr_tokens'))).toBe(true);
  });

  it('resolves a reception scan with registration data only and no clinical summaries', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from patient_card_qr_tokens q')) {
          return { first: TOKEN_ROW, success: true, meta: {} };
        }
        if (normalized.includes('from patients') && normalized.includes('where tenant_id = ? and uhid = ?')) {
          return { first: null, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: healthRecordRoutes,
      routePath: '/api',
      role: 'reception',
      tenantId: 'tenant-b',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/health-record/card-qr/scan', {
      method: 'POST',
      body: { payload: 'https://example.test/qr/patient-card/raw-token' },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.scope).toBe('registration');
    expect(data.can_import).toBe(true);
    expect(data.patient.name).toBe('Sokina');
    expect(data.clinical_summaries).toBeUndefined();
    expect(mockDB.queries.some((q) => q.method === 'run' && q.sql.includes('INSERT INTO patient_card_qr_scan_audit'))).toBe(true);
  });

  it('imports a scanned patient into the current hospital without changing the global UHID', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();
        if (normalized.includes('from patient_card_qr_tokens q')) {
          return { first: TOKEN_ROW, success: true, meta: {} };
        }
        if (normalized.includes('where tenant_id = ? and (uhid = ?')) {
          return { first: null, success: true, meta: {} };
        }
        if (normalized.includes('insert into sequence_counters')) {
          return { first: { current_value: 42 }, success: true, meta: {} };
        }
        return null;
      },
    });

    const { app } = createTestApp({
      route: healthRecordRoutes,
      routePath: '/api',
      role: 'reception',
      tenantId: 'tenant-b',
      userId: 9,
      mockDB,
    });

    const res = await jsonRequest(app, '/api/health-record/card-qr/import', {
      method: 'POST',
      body: { payload: 'raw-token' },
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.imported).toBe(true);
    expect(data.patient.uhid).toBe('OZ-8F4K-92Q7');
    expect(data.patient.patient_code).toBe('P-000042');
    const insert = mockDB.queries.find((q) => q.method === 'run' && q.sql.includes('INSERT INTO patients'));
    expect(insert?.params).toContain('OZ-8F4K-92Q7');
  });
});
