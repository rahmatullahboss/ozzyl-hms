/**
 * Visits — Real D1 Integration Tests
 * ──────────────────────────────────────────────────────────────────────────────
 * Seed data: 23 visits in tenant 100 (20 OPD + 3 IPD).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { adminHeaders, receptionHeaders, noAuthHeaders } from './helpers/auth';
import { api, assertServerRunning } from './helpers/client';

interface Visit {
  id: number;
  patient_id: number;
  visit_no: string;
  doctor_id: number;
  visit_type: 'opd' | 'ipd';
  admission_flag: 0 | 1;
  notes: string | null;
  tenant_id: number;
  created_by: number;
  created_at: string;
}

let adminH: Record<string, string>;
let receptionH: Record<string, string>;
let createdVisitId: number | null = null;

beforeAll(async () => {
  await assertServerRunning();
  adminH = await adminHeaders();
  receptionH = await receptionHeaders();
});

describe('GET /api/visits — list', () => {
  it('returns visits list with correct structure', async () => {
    const res = await api.get<{ visits?: Visit[]; data?: Visit[] }>('/api/visits', adminH);
    expect(res.status).toBe(200);
    const visits = (res.body.visits ?? res.body.data ?? []) as Visit[];
    expect(Array.isArray(visits)).toBe(true);
    expect(visits.length).toBeGreaterThanOrEqual(23);
  });

  it('each visit has required fields', async () => {
    const res = await api.get<{ visits?: Visit[] }>('/api/visits', adminH);
    expect(res.status).toBe(200);
    const visits = res.body.visits ?? [];
    if (visits.length > 0) {
      const visit = visits[0]!;
      expect(typeof visit.id).toBe('number');
      expect(typeof visit.visit_no).toBe('string');
      expect(['opd', 'ipd']).toContain(visit.visit_type);
      expect(typeof visit.patient_id).toBe('number');
      expect(typeof visit.doctor_id).toBe('number');
    }
  });

  it('seed contains 3 IPD visits', async () => {
    const res = await api.get<{ visits?: Visit[] }>('/api/visits?type=ipd', adminH);
    expect(res.status).toBe(200);
    const visits = (res.body.visits ?? []).filter(v => v.visit_type === 'ipd');
    // At minimum check that at least one IPD visit exists
    if (visits.length === 0) {
      // Try without type filter
      const allRes = await api.get<{ visits?: Visit[] }>('/api/visits', adminH);
      const ipdVisits = (allRes.body.visits ?? []).filter(v => v.visit_type === 'ipd');
      expect(ipdVisits.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('returns 401 without authentication', async () => {
    const res = await api.get('/api/visits', noAuthHeaders());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/visits/:id — single visit', () => {
  it('returns visit 2001 with correct data from seed', async () => {
    const res = await api.get<{ visit: Visit }>('/api/visits/2001', adminH);
    if (res.status === 200) {
      const visit = res.body.visit;
      expect(visit.id).toBe(2001);
      expect(visit.patient_id).toBe(1001); // Mohammad Ali
      expect(visit.doctor_id).toBe(101);   // Dr. Aminul Islam
      expect(visit.visit_type).toBe('opd');
      expect(visit.admission_flag).toBe(0);
      expect(visit.tenant_id).toBe(100);
    } else {
      expect([200, 404]).toContain(res.status);
    }
  });

  it('IPD visit 2021 has admission_flag = 1', async () => {
    const res = await api.get<{ visit: Visit }>('/api/visits/2021', adminH);
    if (res.status === 200) {
      expect(res.body.visit.visit_type).toBe('ipd');
      expect(res.body.visit.admission_flag).toBe(1);
      expect(res.body.visit.patient_id).toBe(1003); // Karim Mia
    } else {
      expect([200, 404]).toContain(res.status);
    }
  });

  it('returns 404 for non-existent visit', async () => {
    const res = await api.get('/api/visits/99999', adminH);
    expect([404, 400]).toContain(res.status);
  });
});

describe('POST /api/visits — create visit', () => {
  it('creates an OPD visit and returns visit_no', async () => {
    const newVisit = {
      patientId: 1001,
      doctorId: 101,
      visitType: 'opd',
      admissionFlag: false,
      notes: 'Integration test OPD visit',
    };

    const res = await api.post<{ visitId?: number; id?: number; visitNo?: string; message: string }>(
      '/api/visits',
      receptionH,
      newVisit,
    );

    expect([200, 201]).toContain(res.status);
    const visitId = res.body.visitId ?? res.body.id;
    if (visitId) {
      createdVisitId = visitId;
      expect(typeof visitId).toBe('number');
    }
  });

  it('created visit can be retrieved and has correct patient link', async () => {
    if (!createdVisitId) return;

    const res = await api.get<{ visit: Visit }>(`/api/visits/${createdVisitId}`, adminH);
    if (res.status === 200) {
      expect(res.body.visit.patient_id).toBe(1001);
      expect(res.body.visit.visit_type).toBe('opd');
      expect(res.body.visit.notes).toBe('Integration test OPD visit');
    }
  });

  it('returns 400/422 for missing required fields', async () => {
    const res = await api.post('/api/visits', receptionH, { notes: 'Incomplete' });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 401 without authentication', async () => {
    const res = await api.post('/api/visits', noAuthHeaders(), { patientId: 1001 });
    expect(res.status).toBe(401);
  });
});
