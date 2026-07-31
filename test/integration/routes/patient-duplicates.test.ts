import { describe, it, expect } from 'vitest';
import dupRoutes from '../../../src/routes/tenant/patientDuplicates';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const PT_1 = { id: 1, tenant_id: 'tenant-1', name: 'Rahim Uddin', patient_code: 'P001', mobile: '01711111111', national_id: '1234567890', date_of_birth: '1990-05-15', address: 'Dhaka' };
const PT_2 = { id: 2, tenant_id: 'tenant-1', name: 'Rahim Uddin', patient_code: 'P002', mobile: '01711111111', national_id: '1234567890', date_of_birth: '1990-05-15', address: 'Mirpur, Dhaka' };
const PT_3 = { id: 3, tenant_id: 'tenant-1', name: 'Karim Ahmed', patient_code: 'P003', mobile: '01899999999', national_id: null, date_of_birth: null, address: 'Chittagong' };
const MERGE_LOG = { id: 1, tenant_id: 'tenant-1', primary_patient_id: 1, merged_patient_id: 2, merged_data: '{}', tables_updated: '{"visits":3}', merge_reason: 'Same NID', merged_by: 1, merged_at: '2025-04-07T10:00:00Z', primary_name: 'Rahim Uddin', primary_code: 'P001' };

function mergePipelineOverride(sql: string) {
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase();
  if (normalized.includes('select * from patient_merge_confirmation')) {
    return {
      first: {
        id: 44,
        request_hash: 'merge-request-hash',
        primary_patient_id: 1,
        secondary_patient_id: 2,
        status: 'pending',
        applied_at: null,
        applied_merge_log_id: null,
        expires_at: '2099-01-01T00:00:00.000Z',
      },
    };
  }
  if (normalized.includes('select id from patient_merge_log')) {
    return { first: { id: 88 } };
  }
  return null;
}

describe('Patient Duplicates Routes', () => {

  // Stats
  describe('GET /stats', () => {
    it('returns 200 with duplicate counts', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2, PT_3], patient_merge_log: [] }, universalFallback: true });
      const res = await app.request('/dup/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('duplicate_phones');
      expect(body).toHaveProperty('duplicate_nids');
      expect(body).toHaveProperty('total_merges');
    });
  });

  // Scan
  describe('GET /scan', () => {
    it('returns 200 with phone method', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2] }, universalFallback: true });
      const res = await app.request('/dup/scan?method=phone');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });

    it('returns 200 with nid method', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2] }, universalFallback: true });
      expect((await app.request('/dup/scan?method=nid')).status).toBe(200);
    });

    it('returns 200 with name_dob method', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2] }, universalFallback: true });
      expect((await app.request('/dup/scan?method=name_dob')).status).toBe(200);
    });

    it('returns 200 with auto (default)', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2] }, universalFallback: true });
      expect((await app.request('/dup/scan')).status).toBe(200);
    });

    it('rejects invalid method (400)', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: {} });
      expect((await app.request('/dup/scan?method=fuzzy')).status).toBe(400);
    });
  });

  // Compare
  describe('GET /compare', () => {
    it('returns 200 with both patients + record counts', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2] }, universalFallback: true });
      const res = await app.request('/dup/compare?id1=1&id2=2');
      expect(res.status).toBe(200);
      const body = await res.json() as { patient1: unknown; patient2: unknown };
      expect(body).toHaveProperty('patient1');
      expect(body).toHaveProperty('patient2');
    });

    it('returns 404 if patient not found', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [] } });
      expect((await app.request('/dup/compare?id1=999&id2=998')).status).toBe(404);
    });

    it('rejects missing id1 (400)', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: {} });
      expect((await app.request('/dup/compare?id2=2')).status).toBe(400);
    });
  });

  // Merge
  describe('POST /merge', () => {
    it('rejects non-admin merge attempts (403)', async () => {
      const { app } = createTestApp({
        route: dupRoutes,
        routePath: '/dup',
        role: 'reception',
        tables: { patients: [PT_1, PT_2] },
      });

      const res = await jsonRequest(app, '/dup/merge', {
        method: 'POST',
        body: { primary_id: 1, secondary_id: 2, merge_reason: 'Same NID' },
      });
      expect(res.status).toBe(403);
    });

    it('returns 200 with merge result', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [PT_1, PT_2], patient_merge_log: [], admissions: [] }, queryOverride: mergePipelineOverride, universalFallback: false });
      const res = await jsonRequest(app, '/dup/merge', { method: 'POST', body: { primary_id: 1, secondary_id: 2, merge_reason: 'Same NID' } });
      expect(res.status).toBe(200);
      const body = await res.json() as { message: string; tables_updated: unknown };
      expect(body.message).toContain('merged');
      expect(body).toHaveProperty('tables_updated');
    });

    it('rejects same ID (400)', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/dup/merge', { method: 'POST', body: { primary_id: 1, secondary_id: 1, merge_reason: 'test' } })).status).toBe(400);
    });

    it('rejects missing merge_reason (400)', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/dup/merge', { method: 'POST', body: { primary_id: 1, secondary_id: 2 } })).status).toBe(400);
    });

    it('returns 404 if primary not found', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patients: [] } });
      expect((await jsonRequest(app, '/dup/merge', { method: 'POST', body: { primary_id: 999, secondary_id: 998, merge_reason: 'test' } })).status).toBe(404);
    });
  });

  // History
  describe('GET /history', () => {
    it('returns 200 with merge history', async () => {
      const { app } = createTestApp({ route: dupRoutes, routePath: '/dup', role: 'hospital_admin', tables: { patient_merge_log: [MERGE_LOG] }, universalFallback: true });
      const res = await app.request('/dup/history');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });
});
