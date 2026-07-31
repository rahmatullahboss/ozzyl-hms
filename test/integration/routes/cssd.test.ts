/**
 * Integration tests for src/routes/tenant/cssd.ts
 */

import { describe, it, expect } from 'vitest';
import cssdRoutes from '../../../src/routes/tenant/cssd';
import { createTestApp, jsonRequest } from '../helpers/test-app';

const SET_1 = { id: 1, tenant_id: 'tenant-1', set_name: 'General Surgery', set_code: 'GS-01', department: 'OT', item_count: 25, is_active: 1 };
const CYCLE_1 = { id: 1, tenant_id: 'tenant-1', cycle_number: 'CYC-20250407-001', cycle_type: 'gravity', temperature_celsius: 134, start_time: '2025-04-07T08:00:00Z', status: 'in_progress', biological_indicator: 'pending', chemical_indicator: 'pending' };
const CYCLE_DONE = { ...CYCLE_1, id: 2, cycle_number: 'CYC-20250407-002', status: 'completed', biological_indicator: 'pass', chemical_indicator: 'pass', indicator_passed: 1 };
const ITEM_1 = { id: 1, tenant_id: 'tenant-1', cycle_id: 2, instrument_set_id: 1, status: 'sterilized', expiry_date: '2025-05-07', used: 0, indicator_passed: 1, set_name: 'General Surgery', set_code: 'GS-01', cycle_number: 'CYC-20250407-002', sterilized_at: '2025-04-07' };
const COLLECTION_1 = { id: 1, tenant_id: 'tenant-1', instrument_set_id: 1, received_from: 'OT 1', condition: 'dirty', received_at: '2025-04-07T14:00:00Z', set_name: 'General Surgery' };

describe('CSSD Routes', () => {

  // ── Sets ─────────────────────────────────────────────────────────────────
  describe('GET /sets', () => {
    it('returns 200 with data', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_instrument_sets: [SET_1] }, universalFallback: true });
      const res = await app.request('/cssd/sets');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /sets', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/sets', { method: 'POST', body: { set_name: 'C-Section Set', set_code: 'CS-01', department: 'Labor', item_count: 18 } });
      expect(res.status).toBe(201);
    });

    it('rejects missing set_name (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/sets', { method: 'POST', body: { department: 'OT' } });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /sets/:id', () => {
    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_instrument_sets: [] } });
      const res = await app.request('/cssd/sets/999', { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  // ── Stats ───────────────────────────────────────────────────────────────
  describe('GET /stats', () => {
    it('returns 200 with all KPIs', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_instrument_sets: [SET_1], cssd_sterilization_cycles: [CYCLE_1], cssd_cycle_items: [ITEM_1], cssd_collection_log: [] }, universalFallback: true });
      const res = await app.request('/cssd/stats');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('total_sets');
      expect(body).toHaveProperty('sterile_ready');
      expect(body).toHaveProperty('today_cycles');
    });
  });

  // ── Cycles ──────────────────────────────────────────────────────────────
  describe('GET /cycles', () => {
    it('returns 200 with pagination', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [CYCLE_1] }, universalFallback: true });
      const res = await app.request('/cssd/cycles');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[]; pagination: unknown };
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('pagination');
    });
  });

  describe('POST /cycles', () => {
    it('returns 201 with cycle_number', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [], cssd_cycle_items: [] }, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/cycles', { method: 'POST', body: { cycle_type: 'prevacuum', temperature_celsius: 134, start_time: '2025-04-07T09:00:00Z', instrument_set_ids: [1] } });
      expect(res.status).toBe(201);
      const body = await res.json() as { cycle_number: string };
      expect(body.cycle_number).toMatch(/^CYC-/);
    });

    it('rejects empty instrument_set_ids (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/cycles', { method: 'POST', body: { start_time: '2025-04-07T09:00:00Z', instrument_set_ids: [] } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid cycle_type (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/cycles', { method: 'POST', body: { cycle_type: 'microwave', start_time: '2025-04-07T09:00:00Z', instrument_set_ids: [1] } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /cycles/:id/complete', () => {
    it('completes with pass (200)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [CYCLE_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/cycles/1/complete', { method: 'PUT', body: { status: 'completed', biological_indicator: 'pass', chemical_indicator: 'pass', indicator_passed: true } });
      expect(res.status).toBe(200);
    });

    it('fails cycle and marks items (200)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [CYCLE_1], cssd_cycle_items: [ITEM_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/cycles/1/complete', { method: 'PUT', body: { status: 'failed', biological_indicator: 'fail', failure_reason: 'BI positive' } });
      expect(res.status).toBe(200);
    });

    it('rejects invalid status (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/cycles/1/complete', { method: 'PUT', body: { status: 'running' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid indicator value (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/cycles/1/complete', { method: 'PUT', body: { status: 'completed', biological_indicator: 'maybe' } });
      expect(res.status).toBe(400);
    });
  });

  // ── Items ───────────────────────────────────────────────────────────────
  describe('PUT /items/:id/issue', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_cycle_items: [ITEM_1], cssd_sterilization_cycles: [CYCLE_DONE] }, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/items/1/issue', { method: 'PUT', body: { issued_to: 'OT 2' } });
      expect(res.status).toBe(200);
    });

    it('rejects empty issued_to (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/items/1/issue', { method: 'PUT', body: { issued_to: '' } });
      expect(res.status).toBe(400);
    });
  });

  describe('PUT /items/:id/used', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_cycle_items: [ITEM_1] }, universalFallback: true });
      const res = await app.request('/cssd/items/1/used', { method: 'PUT' });
      expect(res.status).toBe(200);
    });
  });

  // ── Inventory ───────────────────────────────────────────────────────────
  describe('GET /inventory', () => {
    it('returns 200 with sterile packs', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_cycle_items: [ITEM_1] }, universalFallback: true });
      const res = await app.request('/cssd/inventory');
      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body).toHaveProperty('data');
    });
  });

  // ── Cycle Detail ─────────────────────────────────────────────────────
  describe('GET /cycles/:id', () => {
    it('returns cycle with items', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [CYCLE_DONE], cssd_cycle_items: [ITEM_1] }, universalFallback: true });
      const res = await app.request('/cssd/cycles/2');
      expect(res.status).toBe(200);
      const body = await res.json() as { items: unknown[] };
      expect(body).toHaveProperty('items');
    });

    it('returns 404 for non-existent', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [] } });
      const res = await app.request('/cssd/cycles/999');
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /cycles/:id/complete — cancelled', () => {
    it('accepts cancelled status (200)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_sterilization_cycles: [CYCLE_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/cycles/1/complete', { method: 'PUT', body: { status: 'cancelled', failure_reason: 'Machine error before start' } });
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /sets/:id — validation', () => {
    it('rejects negative item_count (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/sets/1', { method: 'PUT', body: { item_count: -5 } });
      expect(res.status).toBe(400);
    });

    it('accepts valid update (200)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_instrument_sets: [SET_1] }, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/sets/1', { method: 'PUT', body: { set_name: 'Updated Name', item_count: 30 } });
      expect(res.status).toBe(200);
    });
  });

  // ── Collections ─────────────────────────────────────────────────────────
  describe('GET /collections', () => {
    it('returns 200', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: { cssd_collection_log: [COLLECTION_1] }, universalFallback: true });
      const res = await app.request('/cssd/collections');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /collections', () => {
    it('returns 201', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {}, universalFallback: true });
      const res = await jsonRequest(app, '/cssd/collections', { method: 'POST', body: { received_from: 'OT 1', condition: 'contaminated', item_count: 15 } });
      expect(res.status).toBe(201);
    });

    it('rejects missing received_from (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/collections', { method: 'POST', body: { condition: 'dirty' } });
      expect(res.status).toBe(400);
    });

    it('rejects invalid condition (400)', async () => {
      const { app } = createTestApp({ route: cssdRoutes, routePath: '/cssd', role: 'hospital_admin', tables: {} });
      const res = await jsonRequest(app, '/cssd/collections', { method: 'POST', body: { received_from: 'OT', condition: 'clean' } });
      expect(res.status).toBe(400);
    });
  });
});
