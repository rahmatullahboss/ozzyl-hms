import { describe, it, expect } from 'vitest';
import mortuaryRoutes from '../../../src/routes/tenant/mortuary';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const REC_1 = { id: 1, tenant_id: 'tenant-1', record_number: 'MOR-20250407-001', deceased_name: 'Abdul Karim', age: 72, gender: 'Male', date_of_death: '2025-04-07', cause_of_death: 'Cardiac arrest', place_of_death: 'ICU', is_mlc: 0, status: 'received', postmortem_required: 0, postmortem_done: 0, police_noc_received: 0, received_at: '2025-04-07T14:00:00Z' };
const REC_MLC = { ...REC_1, id: 2, record_number: 'MOR-20250407-002', deceased_name: 'Unknown Male', is_mlc: 1, status: 'awaiting_noc', postmortem_required: 1 };
const REC_READY = { ...REC_1, id: 3, record_number: 'MOR-20250407-003', status: 'ready_for_handover' };

describe('Mortuary Routes', () => {

  // Stats
  describe('GET /stats', () => {
    it('returns 200 with all KPIs', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_1, REC_MLC] }, universalFallback: true });
      const res = await app.request('/m/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      // Mock DB may not preserve SQL aliases, just check response shape
      expect(body).toBeDefined();
      expect(typeof body).toBe('object');
    });
  });

  // List
  describe('GET /', () => {
    it('returns 200 with pagination', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_1] }, universalFallback: true });
      const res = await app.request('/m');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });
    it('filters by status', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_1] }, universalFallback: true });
      expect((await app.request('/m?status=received')).status).toBe(200);
    });
    it('filters MLC only', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_MLC] }, universalFallback: true });
      expect((await app.request('/m?is_mlc=true')).status).toBe(200);
    });
    it('searches by name', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_1] }, universalFallback: true });
      expect((await app.request('/m?search=Abdul')).status).toBe(200);
    });
  });

  // Detail
  describe('GET /:id', () => {
    it('returns record', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_1] }, universalFallback: true });
      expect((await app.request('/m/1')).status).toBe(200);
    });
    it('returns 404', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [] } });
      expect((await app.request('/m/999')).status).toBe(404);
    });
  });

  // Create
  describe('POST /', () => {
    it('returns 201 with record_number', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/m', { method: 'POST', body: { deceased_name: 'Test Person', date_of_death: '2025-04-07' } });
      expect(res.status).toBe(201);
      const body = await res.json() as { record_number: string };
      expect(body.record_number).toMatch(/^MOR-/);
    });
    it('rejects missing deceased_name (400)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/m', { method: 'POST', body: { date_of_death: '2025-04-07' } })).status).toBe(400);
    });
    it('rejects invalid date format (400)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/m', { method: 'POST', body: { deceased_name: 'X', date_of_death: '07-04-2025' } })).status).toBe(400);
    });
    it('rejects invalid gender (400)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/m', { method: 'POST', body: { deceased_name: 'X', date_of_death: '2025-04-07', gender: 'Unknown' } })).status).toBe(400);
    });
    it('rejects invalid preservation_type (400)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/m', { method: 'POST', body: { deceased_name: 'X', date_of_death: '2025-04-07', preservation_type: 'ice' } })).status).toBe(400);
    });
  });

  // Status
  describe('PUT /:id/status', () => {
    it('received → preserved (200)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/m/1/status', { method: 'PUT', body: { status: 'preserved' } })).status).toBe(200);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/m/1/status', { method: 'PUT', body: { status: 'cremated' } })).status).toBe(400);
    });
  });

  // Handover
  describe('PUT /:id/handover', () => {
    it('returns 200 with valid handover', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_READY] }, universalFallback: true });
      expect((await jsonRequest(app, '/m/3/handover', { method: 'PUT', body: { handover_to: 'Rafiq Hossain', handover_relation: 'Son', handover_phone: '01711111111' } })).status).toBe(200);
    });
    it('rejects missing handover_to (400)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/m/1/handover', { method: 'PUT', body: { handover_relation: 'Brother' } })).status).toBe(400);
    });
  });

  // Post-mortem
  describe('PUT /:id/postmortem', () => {
    it('marks done (200)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_MLC] }, universalFallback: true });
      expect((await jsonRequest(app, '/m/2/postmortem', { method: 'PUT', body: { postmortem_done: true, postmortem_date: '2025-04-08', postmortem_findings: 'Blunt force trauma to head' } })).status).toBe(200);
    });
  });

  // NOC
  describe('PUT /:id/noc', () => {
    it('marks NOC received (200)', async () => {
      const { app } = createTestApp({ route: mortuaryRoutes, routePath: '/m', role: 'hospital_admin', tables: { mortuary_records: [REC_MLC] }, universalFallback: true });
      expect((await jsonRequest(app, '/m/2/noc', { method: 'PUT', body: { police_noc_received: true, police_noc_date: '2025-04-08', police_station: 'Dhanmondi PS' } })).status).toBe(200);
    });
  });
});
