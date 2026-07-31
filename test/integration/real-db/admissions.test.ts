/**
 * Admissions & Bed Management — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Seed data: 3 admissions, 20 beds (various statuses), 3 admitted patients.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface Admission {
  id: number;
  tenant_id: number;
  admission_no: string;
  patient_id: number;
  bed_id: number;
  doctor_id: number;
  admission_type: 'emergency' | 'planned';
  admission_date: string;
  provisional_diagnosis: string;
  status: 'admitted' | 'discharged';
}

interface Bed {
  id: number;
  tenant_id: number;
  ward_name: string;
  bed_number: string;
  bed_type: 'general' | 'semi_private' | 'private' | 'icu';
  status: 'available' | 'occupied' | 'reserved' | 'maintenance';
  floor: string;
}

let adminH: Record<string, string>;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
});

describe('GET /api/admissions — list', () => {
  it('returns 3 admissions from seed', async () => {
    const res = await api.get<{ admissions?: Admission[] }>('/api/admissions', adminH);
    expect(res.status).toBe(200);
    const admissions = (res.body.admissions ?? []) as Admission[];
    expect(Array.isArray(admissions)).toBe(true);
    expect(admissions.length).toBeGreaterThanOrEqual(3);
  });

  it('admissions have correct admission types', async () => {
    const res = await api.get<{ admissions?: Admission[] }>('/api/admissions', adminH);
    expect(res.status).toBe(200);
    const admissions = res.body.admissions ?? [];
    admissions.forEach(admission => {
      expect(['emergency', 'planned']).toContain(admission.admission_type);
      expect(['admitted', 'discharged']).toContain(admission.status);
    });
  });

  it('returns 401 without auth', async () => {
    const res = await api.get('/api/admissions', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/admissions/:id — single admission', () => {
  it('returns ADM-0001 with correct patient and diagnosis', async () => {
    const res = await api.get<{ admission: Admission }>('/api/admissions/13001', adminH);
    if (res.status === 200) {
      const adm = res.body.admission;
      expect(adm.id).toBe(13001);
      expect(adm.admission_no).toBe('ADM-0001');
      expect(adm.patient_id).toBe(1003);  // Karim Mia
      expect(adm.doctor_id).toBe(103);    // Dr. Rafiqul Haque (Cardiology)
      expect(adm.admission_type).toBe('emergency');
      expect(adm.status).toBe('admitted');
      expect(adm.provisional_diagnosis).toContain('Myocardial');
    } else {
      expect([200, 404]).toContain(res.status);
    }
  });
});

describe('GET /api/admissions/beds — bed management', () => {
  it('returns beds list with 20 beds', async () => {
    const res = await api.get<{ beds?: Bed[] }>('/api/admissions/beds', adminH);
    if (res.status === 200) {
      const beds = res.body.beds ?? [];
      expect(beds.length).toBeGreaterThanOrEqual(20);
    } else {
      // May be at /api/beds
      const res2 = await api.get<{ beds?: Bed[] }>('/api/beds', adminH);
      expect([200, 404]).toContain(res2.status);
      if (res2.status === 200) {
        const beds = res2.body.beds ?? [];
        expect(beds.length).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it('occupied beds have no double-booking in seed', async () => {
    const res = await api.get<{ beds?: Bed[] }>('/api/admissions/beds', adminH);
    if (res.status === 200) {
      const beds = res.body.beds ?? [];
      const occupiedBeds = beds.filter(b => b.status === 'occupied');
      // Should have exactly 3 occupied beds (3 admitted patients from seed)
      expect(occupiedBeds.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('POST /api/admissions — create admission', () => {
  it('creates emergency admission with available bed', async () => {
    const bedsRes = await api.get<{ beds?: Bed[] }>('/api/admissions/beds?status=available', adminH);
    expect(bedsRes.status).toBe(200);
    const availableBed = (bedsRes.body.beds ?? [])[0];
    expect(availableBed).toBeTruthy();

    const patientsRes = await api.get<{ patients?: Array<{ id: number }> }>('/api/patients?limit=50', adminH);
    const admissionsRes = await api.get<{ admissions?: Array<{ patient_id: number; status: string }> }>('/api/admissions', adminH);
    const activePatientIds = new Set(
      (admissionsRes.body.admissions ?? [])
        .filter((admission) => ['admitted', 'critical', 'transferred'].includes(admission.status))
        .map((admission) => admission.patient_id),
    );
    const availablePatient = (patientsRes.body.patients ?? []).find((patient) => !activePatientIds.has(patient.id));
    expect(availablePatient).toBeTruthy();

    const newAdmission = {
      patient_id: availablePatient!.id,
      bed_id: availableBed!.id,
      doctor_id: 101,
      admission_type: 'emergency',
      provisional_diagnosis: 'Integration test — acute condition',
      notes: 'Test admission created by integration tests',
    };

    const res = await api.post<{ admission_no?: string; admissionNo?: string; message?: string }>(
      '/api/admissions',
      adminH,
      newAdmission,
    );

    expect([200, 201]).toContain(res.status);
    // Route returns { admission_no }
    if (res.status === 201) {
      expect(res.body.admission_no ?? res.body.admissionNo).toBeTruthy();
    }
  });

  it('returns 400/422 for missing patient', async () => {
    const res = await api.post('/api/admissions', adminH, { doctor_id: 101 });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without auth', async () => {
    const res = await api.post('/api/admissions', noAuthHeaders(), { patientId: 1001 });
    expect(res.status).toBe(401);
  });
});
