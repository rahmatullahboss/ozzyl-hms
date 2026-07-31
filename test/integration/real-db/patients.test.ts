/**
 * Patients — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Tests run against a real wrangler dev server on http://localhost:8787.
 * Seed data: 20 patients in tenant 100 (City Care General Hospital).
 *
 * Prerequisites:
 *   1. Run: npm run test:real:setup  (migrate + seed)
 *   2. Run: npm run dev:api          (wrangler dev)
 *   3. Run: npm run test:real        (this file)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, receptionHeaders, noAuthHeaders, wrongTenantHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Patient {
  id: number;
  patient_code: string;
  name: string;
  father_husband: string | null;
  address: string | null;
  mobile: string | null;
  guardian_mobile: string | null;
  age: number | null;
  gender: string | null;
  blood_group: string | null;
  tenant_id: number;
  created_at: string;
}

interface PatientsListResponse {
  patients: Patient[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface CreatePatientResponse {
  message: string;
  patientId: number;
  patientCode: string;
  serial: string;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let adminH: Record<string, string>;
let receptionH: Record<string, string>;
let createdPatientId: number | null = null;
const patientRunMobile = `017${String(Date.now()).slice(-8)}`;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  receptionH = await receptionHeaders();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/patients — list', () => {
  it('returns patient list with correct structure', async () => {
    const res = await api.get<PatientsListResponse>('/api/patients', adminH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('patients');
    expect(res.body).toHaveProperty('hasMore');
    expect(res.body).toHaveProperty('nextCursor');
    expect(Array.isArray(res.body.patients)).toBe(true);
    // Seed has 20 patients — should return up to 50 (default limit)
    expect(res.body.patients.length).toBeGreaterThanOrEqual(20);
  });

  it('each patient has required fields with correct types', async () => {
    const res = await api.get<PatientsListResponse>('/api/patients', adminH);

    expect(res.status).toBe(200);
    const patient = res.body.patients[0]!;
    expect(typeof patient.id).toBe('number');
    expect(typeof patient.patient_code).toBe('string');
    expect(typeof patient.name).toBe('string');
    expect(typeof patient.tenant_id).toBe('number');
    expect(typeof patient.created_at).toBe('string');
  });

  it('filters by name search', async () => {
    const res = await api.get<PatientsListResponse>('/api/patients?search=Mohammad', adminH);

    expect(res.status).toBe(200);
    expect(res.body.patients.length).toBeGreaterThanOrEqual(1);
    // Every result must contain 'Mohammad' in name, mobile, or patient_code
    res.body.patients.forEach(p => {
      const matches =
        p.name.toLowerCase().includes('mohammad') ||
        (p.mobile ?? '').includes('Mohammad') ||
        (p.patient_code ?? '').toLowerCase().includes('mohammad');
      expect(matches).toBe(true);
    });
  });

  it('returns empty array for non-matching search', async () => {
    const res = await api.get<PatientsListResponse>('/api/patients?search=ZZZNOMATCH999XYZ', adminH);

    expect(res.status).toBe(200);
    expect(res.body.patients).toEqual([]);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  it('respects limit parameter', async () => {
    const res = await api.get<PatientsListResponse>('/api/patients?limit=5', adminH);

    expect(res.status).toBe(200);
    expect(res.body.patients.length).toBeLessThanOrEqual(5);
    // Should have more since seed has 20
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('cursor pagination works correctly', async () => {
    // Get first page
    const page1 = await api.get<PatientsListResponse>('/api/patients?limit=5', adminH);
    expect(page1.status).toBe(200);
    expect(page1.body.nextCursor).not.toBeNull();

    // Get second page using cursor
    const cursor = page1.body.nextCursor!;
    const page2 = await api.get<PatientsListResponse>(
      `/api/patients?limit=5&cursor=${cursor}`,
      adminH,
    );
    expect(page2.status).toBe(200);
    expect(page2.body.patients.length).toBeGreaterThan(0);

    // No overlap between pages
    const page1Ids = page1.body.patients.map(p => p.id);
    const page2Ids = page2.body.patients.map(p => p.id);
    const overlap = page1Ids.filter(id => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/patients', noAuthHeaders());
    expect(res.status).toBe(401);
  });

  it('tenant isolation — wrong tenant sees no data from tenant 100', async () => {
    const wrongH = await wrongTenantHeaders();
    const res = await api.get<PatientsListResponse>('/api/patients', wrongH);
    expect(res.status).toBe(200);
    // Tenant 999 has no patients — must return empty
    expect(res.body.patients).toHaveLength(0);
  });
});

describe('GET /api/patients/:id — single patient', () => {
  it('returns correct patient by ID from seed data', async () => {
    // Patient 1001 = Mohammad Ali (from seed_demo.sql)
    const res = await api.get<{ patient: Patient }>('/api/patients/1001', adminH);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('patient');
    const p = res.body.patient;
    expect(p.id).toBe(1001);
    expect(p.name).toBe('Mohammad Ali');
    expect(p.patient_code).toBe('P-001');
    expect(p.gender).toBe('male');
    expect(p.blood_group).toBe('B+');
    expect(p.tenant_id).toBe(100);
  });

  it('returns 404 for non-existent patient', async () => {
    const res = await api.get('/api/patients/99999', adminH);
    expect(res.status).toBe(404);
    // Hono HTTPException returns { message } or plain text depending on error handler
    if (typeof res.body === 'object' && res.body !== null) {
      expect(res.body).toHaveProperty('message');
    }
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/patients/1001', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/patients — create', () => {
  const newPatient = {
    name: 'Integration Test Patient',
    fatherHusband: 'Test Father',
    address: 'Test Address, Dhaka',
    mobile: patientRunMobile,
    age: 35,
    gender: 'male',
    bloodGroup: 'A+',
  };

  it('creates a patient and returns 201 with patientId, patientCode, serial', async () => {
    const res = await api.post<CreatePatientResponse>('/api/patients', receptionH, newPatient);

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Patient registered');
    expect(typeof res.body.patientId).toBe('number');
    expect(res.body.patientCode).toMatch(/^P-/);
    expect(typeof res.body.serial).toBe('string');

    createdPatientId = res.body.patientId;
  });

  it('created patient can be retrieved immediately by ID', async () => {
    expect(createdPatientId).not.toBeNull();

    const res = await api.get<{ patient: Patient }>(
      `/api/patients/${createdPatientId}`,
      adminH,
    );

    expect(res.status).toBe(200);
    expect(res.body.patient.name).toBe('Integration Test Patient');
    expect(res.body.patient.mobile).toBe(patientRunMobile);
    expect(res.body.patient.gender).toBe('male');
    expect(res.body.patient.blood_group).toBe('A+');
    expect(res.body.patient.tenant_id).toBe(100);
  });

  it('created patient appears in list search', async () => {
    const res = await api.get<PatientsListResponse>(
      '/api/patients?search=Integration Test Patient',
      adminH,
    );

    expect(res.status).toBe(200);
    expect(res.body.patients.some(p => p.name === 'Integration Test Patient')).toBe(true);
  });

  it('returns 400/422 for missing required name field', async () => {
    const res = await api.post('/api/patients', receptionH, {
      fatherHusband: 'Test',
      mobile: '01700000000',
    });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.post('/api/patients', noAuthHeaders(), newPatient);
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/patients/:id — update', () => {
  it('updates patient and changes are reflected in GET', async () => {
    expect(createdPatientId).not.toBeNull();

    const updateRes = await api.put(
      `/api/patients/${createdPatientId}`,
      adminH,
      { mobile: '01700000088', address: 'Updated Address, Chittagong' },
    );

    expect(updateRes.status).toBe(200);
    expect((updateRes.body as { message: string }).message).toBe('Patient updated');

    // Verify the change
    const getRes = await api.get<{ patient: Patient }>(
      `/api/patients/${createdPatientId}`,
      adminH,
    );
    expect(getRes.status).toBe(200);
    expect(getRes.body.patient.mobile).toBe('01700000088');
    expect(getRes.body.patient.address).toBe('Updated Address, Chittagong');
    // Name unchanged (partial update)
    expect(getRes.body.patient.name).toBe('Integration Test Patient');
  });

  it('returns 404 for non-existent patient', async () => {
    const res = await api.put('/api/patients/99999', adminH, { name: 'Ghost' });
    expect(res.status).toBe(404);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.put(
      `/api/patients/${createdPatientId}`,
      noAuthHeaders(),
      { name: 'Should Fail' },
    );
    expect(res.status).toBe(401);
  });
});
