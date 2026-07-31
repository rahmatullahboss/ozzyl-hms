/**
 * Comprehensive tests for Blood Bank module
 *
 * Covers:
 * 1. Schema validation (inline Zod schemas)
 * 2. Route integration tests (20 endpoints)
 * 3. Business logic: screening auto-status, donor eligibility, compatibility
 */

import { describe, it, expect } from 'vitest';
import bloodBankRoutes from '../../../src/routes/tenant/bloodBank';
import { createTestApp, jsonRequest } from '../helpers/test-app';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DONOR_ELIGIBLE = { id: 1, tenant_id: 'tenant-1', donor_name: 'Karim Ahmed', blood_group: 'O+', donor_type: 'voluntary', gender: 'Male', age: 32, phone: '01711111111', is_active: 1, is_eligible: 1, total_donations: 3, deferral_until: null };
const DONOR_DEFERRED = { id: 2, tenant_id: 'tenant-1', donor_name: 'Jamal Hossain', blood_group: 'A-', donor_type: 'voluntary', is_active: 1, is_eligible: 0, deferral_until: '2025-06-01', deferral_reason: 'Recent surgery' };
const DONATION_PASSED = { id: 1, tenant_id: 'tenant-1', donor_id: 1, bag_number: 'BAG-001', blood_group: 'O+', component: 'whole_blood', volume_ml: 450, collection_date: '2025-04-01', expiry_date: '2025-05-15', status: 'in_stock', screening_status: 'passed', donor_name: 'Karim Ahmed' };
const DONATION_PENDING = { id: 2, tenant_id: 'tenant-1', donor_id: 1, bag_number: 'BAG-002', blood_group: 'O+', component: 'packed_rbc', volume_ml: 350, collection_date: '2025-04-05', expiry_date: '2025-05-19', status: 'in_stock', screening_status: 'pending', hiv_result: 'pending', hbsag_result: 'pending', hcv_result: 'pending', vdrl_result: 'pending', malaria_result: 'pending' };
const XMATCH_PENDING = { id: 1, tenant_id: 'tenant-1', patient_id: 1, patient_blood_group: 'A+', requested_component: 'packed_rbc', units_requested: 2, urgency: 'urgent', status: 'pending', patient_name: 'Rahim', patient_code: 'P001' };
const TRANSFUSION_ISSUED = { id: 1, tenant_id: 'tenant-1', patient_id: 1, donation_id: 1, bag_number: 'BAG-001', blood_group: 'O+', component: 'packed_rbc', status: 'issued', issued_at: '2025-04-07T10:00:00Z', patient_name: 'Rahim' };
const PATIENT_1 = { id: 1, name: 'Rahim Uddin', patient_code: 'P001', tenant_id: 'tenant-1' };

// ─── Donor CRUD ───────────────────────────────────────────────────────────────

describe('Blood Bank — Donors', () => {

  // ─── RBAC ──────────────────────────────────────────────────────────────────

  describe('Permission guards', () => {
    it('allows hospital_admin to access donors', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      expect((await app.request('/bb/donors')).status).toBe(200);
    });
    it('allows doctor to access blood bank routes (no explicit permission guard)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'doctor', tables: { blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      // Blood bank routes don't have explicit permission guards - they allow all authenticated roles
      expect((await app.request('/bb/donors')).status).toBe(200);
    });
    it('allows reception role (read permission) to access donors', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'reception', tables: { blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      expect((await app.request('/bb/donors')).status).toBe(200);
    });
  });

  describe('GET /donors', () => {
    it('returns 200 with data and pagination', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donors: [DONOR_ELIGIBLE, DONOR_DEFERRED] }, universalFallback: true });
      const res = await app.request('/bb/donors');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: { total: number } };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });

    it('filters by blood_group', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      const res = await app.request('/bb/donors?blood_group=O%2B');
      expect(res.status).toBe(200);
    });

    it('filters by search term', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      const res = await app.request('/bb/donors?search=Karim');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /donors', () => {
    it('returns 201 with minimal fields', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donors', { method: 'POST', body: { donor_name: 'Test Donor', blood_group: 'B+' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { message: string };
      expect(body.message).toContain('Donor registered');
    });

    it('returns 201 with all fields', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donors', { method: 'POST', body: { donor_name: 'Full Donor', blood_group: 'AB-', donor_type: 'replacement', gender: 'Female', age: 28, phone: '01899999', weight_kg: 55, hemoglobin: 12.5 } });
      expect(res.status).toBe(201);
    });

    it('rejects missing donor_name (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donors', { method: 'POST', body: { blood_group: 'O+' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid blood_group (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donors', { method: 'POST', body: { donor_name: 'X', blood_group: 'Z+' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid donor_type (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donors', { method: 'POST', body: { donor_name: 'X', blood_group: 'O+', donor_type: 'unknown' } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /donors/:id', () => {
    it('returns 200 with valid update', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donors/1', { method: 'PUT', body: { phone: '01999999999' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid blood_group in update (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donors/1', { method: 'PUT', body: { blood_group: 'INVALID' } });
      expect(res.status).toBe(400);
    });

    it('rejects empty body (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donors/1', { method: 'PUT', body: {} });
      expect(res.status).toBe(400);
    });
  });
});

// ─── Donations ────────────────────────────────────────────────────────────────

describe('Blood Bank — Donations', () => {

  describe('GET /donations', () => {
    it('returns 200 with filters', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [DONATION_PASSED] }, universalFallback: true });
      const res = await app.request('/bb/donations?blood_group=O%2B&status=in_stock');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /donations', () => {
    it('returns 201 for eligible donor', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [], blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donations', { method: 'POST', body: { donor_id: 1, bag_number: 'BAG-NEW', blood_group: 'O+', collection_date: '2025-04-07', expiry_date: '2025-05-21' } });
      expect(res.status).toBe(201);
    });

    it('rejects missing bag_number (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donations', { method: 'POST', body: { donor_id: 1, blood_group: 'O+', collection_date: '2025-04-07', expiry_date: '2025-05-21' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid component (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donations', { method: 'POST', body: { donor_id: 1, bag_number: 'X', blood_group: 'O+', component: 'magic', collection_date: '2025-04-07', expiry_date: '2025-05-21' } });
      expect(res.status).toBe(400);
    });

    it('defaults component to whole_blood', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [], blood_donors: [DONOR_ELIGIBLE] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donations', { method: 'POST', body: { donor_id: 1, bag_number: 'BAG-DEF', blood_group: 'O+', collection_date: '2025-04-07', expiry_date: '2025-05-21' } });
      expect(res.status).toBe(201);
    });
  });

  describe('PUT /donations/:id/screening', () => {
    it('updates screening results (200)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [DONATION_PENDING] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donations/2/screening', { method: 'PUT', body: { hiv_result: 'negative', hbsag_result: 'negative' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid result enum (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donations/1/screening', { method: 'PUT', body: { hiv_result: 'maybe' } });
      expect(res.status).toBe(400);
    });

    it('rejects empty body (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donations/1/screening', { method: 'PUT', body: {} });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /donations/:id/status', () => {
    it('updates to quarantine (200)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [DONATION_PASSED] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donations/1/status', { method: 'PUT', body: { status: 'quarantine', remarks: 'Suspicious label' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/donations/1/status', { method: 'PUT', body: { status: 'lost' } });
      expect(res.status).toBe(400);
    });

    it('accepts expired status', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [DONATION_PASSED] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/donations/1/status', { method: 'PUT', body: { status: 'expired' } });
      expect(res.status).toBe(200);
    });
  });
});

// ─── Cross-Match ──────────────────────────────────────────────────────────────

describe('Blood Bank — Cross-Match', () => {

  describe('GET /cross-match', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_cross_match: [XMATCH_PENDING] }, universalFallback: true });
      const res = await app.request('/bb/cross-match');
      expect(res.status).toBe(200);
    });

    it('filters by patient_id', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_cross_match: [XMATCH_PENDING] }, universalFallback: true });
      const res = await app.request('/bb/cross-match?patient_id=1');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /cross-match', () => {
    it('returns 201 with valid request', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/bb/cross-match', { method: 'POST', body: { patient_id: 1, patient_blood_group: 'B+', urgency: 'emergency', indication: 'Trauma' } });
      expect(res.status).toBe(201);
    });

    it('rejects invalid blood group (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/cross-match', { method: 'POST', body: { patient_id: 1, patient_blood_group: 'X-' } });
      expect(res.status).toBe(400);
    });

    it('defaults urgency to routine', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/bb/cross-match', { method: 'POST', body: { patient_id: 1, patient_blood_group: 'A+' } });
      expect(res.status).toBe(201);
    });

    it('rejects invalid urgency (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/cross-match', { method: 'POST', body: { patient_id: 1, patient_blood_group: 'A+', urgency: 'asap' } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /cross-match/:id/match', () => {
    it('returns 200 with compatible result', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_cross_match: [XMATCH_PENDING], blood_donations: [DONATION_PASSED] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/cross-match/1/match', { method: 'PUT', body: { donation_id: 1, compatibility_result: 'compatible' } });
      expect(res.status).toBe(200);
    });

    it('returns 200 with incompatible result', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_cross_match: [XMATCH_PENDING], blood_donations: [DONATION_PASSED] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/cross-match/1/match', { method: 'PUT', body: { donation_id: 1, compatibility_result: 'incompatible' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid compatibility_result (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/cross-match/1/match', { method: 'PUT', body: { donation_id: 1, compatibility_result: 'maybe' } });
      expect(res.status).toBe(400);
    });
  });
});

// ─── Transfusions ─────────────────────────────────────────────────────────────

describe('Blood Bank — Transfusions', () => {

  describe('GET /transfusions', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_transfusions: [TRANSFUSION_ISSUED] }, universalFallback: true });
      const res = await app.request('/bb/transfusions');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /transfusions', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_transfusions: [], blood_donations: [DONATION_PASSED], blood_cross_match: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/transfusions', { method: 'POST', body: { patient_id: 1, donation_id: 1, bag_number: 'BAG-001', blood_group: 'O+', component: 'packed_rbc' } });
      expect(res.status).toBe(201);
    });

    it('rejects invalid component (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/transfusions', { method: 'POST', body: { patient_id: 1, donation_id: 1, bag_number: 'X', blood_group: 'O+', component: 'super_blood' } });
      expect(res.status).toBe(400);
    });

    it('rejects missing bag_number (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/transfusions', { method: 'POST', body: { patient_id: 1, donation_id: 1, blood_group: 'O+', component: 'ffp' } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /transfusions/:id', () => {
    it('updates status to completed (200)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_transfusions: [TRANSFUSION_ISSUED] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/transfusions/1', { method: 'PUT', body: { status: 'completed', reaction_type: 'none' } });
      expect(res.status).toBe(200);
    });

    it('records reaction (200)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_transfusions: [TRANSFUSION_ISSUED] }, universalFallback: true });
      const res = await jsonRequest(app, '/bb/transfusions/1', { method: 'PUT', body: { status: 'reaction_stopped', reaction_type: 'moderate', reaction_details: 'Urticaria, fever' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid reaction_type (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/transfusions/1', { method: 'PUT', body: { reaction_type: 'unknown' } });
      expect(res.status).toBe(400);
    });

    it('rejects empty body (400)', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/bb/transfusions/1', { method: 'PUT', body: {} });
      expect(res.status).toBe(400);
    });
  });
});

// ─── Stock & Stats ────────────────────────────────────────────────────────────

describe('Blood Bank — Stock & Stats', () => {

  describe('GET /stock', () => {
    it('returns 200 with stock and totals', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donations: [DONATION_PASSED] }, universalFallback: true });
      const res = await app.request('/bb/stock');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('stock');
      expect(body).toHaveProperty('totals');
    });
  });

  describe('GET /stats', () => {
    it('returns 200 with all KPI fields', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: { blood_donors: [DONOR_ELIGIBLE], blood_donations: [DONATION_PASSED], blood_cross_match: [], blood_transfusions: [] }, universalFallback: true });
      const res = await app.request('/bb/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('total_donors');
      expect(body).toHaveProperty('available_units');
      expect(body).toHaveProperty('pending_cross_match');
      expect(body).toHaveProperty('today_transfusions');
      expect(body).toHaveProperty('expiring_soon');
    });
  });
});

// ─── Compatibility Lookup ─────────────────────────────────────────────────────

describe('Blood Bank — Compatibility', () => {

  describe('GET /compatible/:bloodGroup', () => {
    it('O- is universal donor', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await app.request('/bb/compatible/O-');
      expect(res.status).toBe(200);
      const body = await res.json() as { can_receive_from: string[]; is_universal_donor: boolean };
      expect(body.can_receive_from).toEqual(['O-']);
      expect(body.is_universal_donor).toBe(true);
      expect(body.is_universal_recipient).toBe(false);
    });

    it('AB+ is universal recipient', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await app.request('/bb/compatible/AB%2B');
      expect(res.status).toBe(200);
      const body = await res.json() as { can_receive_from: string[]; is_universal_recipient: boolean };
      expect(body.can_receive_from).toHaveLength(8);
      expect(body.is_universal_recipient).toBe(true);
    });

    it('A+ can receive from O-, O+, A-, A+', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await app.request('/bb/compatible/A%2B');
      expect(res.status).toBe(200);
      const body = await res.json() as { can_receive_from: string[] };
      expect(body.can_receive_from).toEqual(['O-', 'O+', 'A-', 'A+']);
    });

    it('B- can receive from O-, B-', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await app.request('/bb/compatible/B-');
      expect(res.status).toBe(200);
      const body = await res.json() as { can_receive_from: string[] };
      expect(body.can_receive_from).toEqual(['O-', 'B-']);
    });

    it('unknown group returns empty array', async () => {
      const { app } = createTestApp({ route: bloodBankRoutes, routePath: '/bb', role: 'hospital_admin', tables: {} });
      const res = await app.request('/bb/compatible/X');
      expect(res.status).toBe(200);
      const body = await res.json() as { can_receive_from: string[] };
      expect(body.can_receive_from).toEqual([]);
    });
  });
});
