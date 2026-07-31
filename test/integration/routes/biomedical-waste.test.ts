import { describe, it, expect } from 'vitest';
import bmwRoutes from '../../../src/routes/tenant/biomedicalWaste';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const CAT_1 = { id: 1, tenant_id: 'tenant-1', category_code: 'Yellow', category_name: 'Infectious Waste', color: 'yellow', disposal_method: 'Incineration', is_active: 1 };
const COLL_1 = { id: 1, tenant_id: 'tenant-1', collection_number: 'BMW-20250407-001', collection_date: '2025-04-07', department: 'OT', category_id: 1, category_name: 'Infectious Waste', weight_kg: 5.2, bag_count: 3, status: 'collected', category_color: 'yellow' };

describe('Biomedical Waste Routes', () => {

  // Categories
  describe('GET /categories', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_categories: [CAT_1] }, universalFallback: true });
      expect((await app.request('/bw/categories')).status).toBe(200);
    });
  });

  describe('POST /categories', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: {}, universalFallback: true });
      expect((await jsonRequest(app, '/bw/categories', { method: 'POST', body: { category_code: 'Red', category_name: 'Sharps', color: 'red' } })).status).toBe(201);
    });
    it('rejects missing color (400)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/bw/categories', { method: 'POST', body: { category_code: 'X', category_name: 'Y' } })).status).toBe(400);
    });
  });

  describe('POST /categories/seed', () => {
    it('seeds defaults when empty', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_categories: [] }, universalFallback: false });
      expect((await jsonRequest(app, '/bw/categories/seed', { method: 'POST', body: {} })).status).toBe(201);
    });
  });

  describe('DELETE /categories/:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_categories: [] } });
      expect((await app.request('/bw/categories/999', { method: 'DELETE' })).status).toBe(404);
    });
  });

  // Stats
  describe('GET /stats', () => {
    it('returns 200 with today + pending + month', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [COLL_1] }, universalFallback: true });
      const res = await app.request('/bw/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('today');
      expect(body).toHaveProperty('pending_disposal');
      expect(body).toHaveProperty('month_weight_kg');
    });
  });

  // Collections
  describe('GET /collections', () => {
    it('returns 200 with pagination', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [COLL_1] }, universalFallback: true });
      const res = await app.request('/bw/collections');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('pagination');
    });
    it('filters by department', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [COLL_1] }, universalFallback: true });
      expect((await app.request('/bw/collections?department=OT')).status).toBe(200);
    });
  });

  describe('POST /collections', () => {
    it('returns 201 with collection_number', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/bw/collections', { method: 'POST', body: { collection_date: '2025-04-07', department: 'Lab', category_id: 1, weight_kg: 2.5 } });
      expect(res.status).toBe(201);
      const body = await res.json() as { collection_number: string };
      expect(body.collection_number).toMatch(/^BMW-/);
    });
    it('rejects missing department (400)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/bw/collections', { method: 'POST', body: { collection_date: '2025-04-07', category_id: 1, weight_kg: 1 } })).status).toBe(400);
    });
    it('rejects invalid date (400)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/bw/collections', { method: 'POST', body: { collection_date: '07-04-2025', department: 'X', category_id: 1, weight_kg: 1 } })).status).toBe(400);
    });
    it('rejects zero weight (400)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/bw/collections', { method: 'POST', body: { collection_date: '2025-04-07', department: 'X', category_id: 1, weight_kg: 0 } })).status).toBe(400);
    });
  });

  describe('PUT /collections/:id/status', () => {
    it('collected → in_transit (200)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [COLL_1] }, universalFallback: true });
      expect((await jsonRequest(app, '/bw/collections/1/status', { method: 'PUT', body: { status: 'in_transit' } })).status).toBe(200);
    });
    it('in_transit → disposed with certificate (200)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [{ ...COLL_1, status: 'in_transit' }] }, universalFallback: true });
      expect((await jsonRequest(app, '/bw/collections/1/status', { method: 'PUT', body: { status: 'disposed', disposal_method: 'Incineration', disposal_certificate: 'CERT-001' } })).status).toBe(200);
    });
    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: {} });
      expect((await jsonRequest(app, '/bw/collections/1/status', { method: 'PUT', body: { status: 'burned' } })).status).toBe(400);
    });
  });

  // Summary
  describe('GET /summary', () => {
    it('returns 200 with grouped data', async () => {
      const { app } = createTestApp({ route: bmwRoutes, routePath: '/bw', role: 'hospital_admin', tables: { bmw_collections: [COLL_1] }, universalFallback: true });
      const res = await app.request('/bw/summary');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });
});
